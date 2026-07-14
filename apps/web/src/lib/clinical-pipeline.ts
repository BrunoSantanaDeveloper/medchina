import { extractAnamnesis } from "@/lib/clinical-extraction";
import { processTranscription, type TranscriptResult } from "@flyee/transcribe";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The consultation pipeline (PRD §10.2): a consented recording becomes a
 * diarized transcript, and the transcript becomes a DRAFT anamnesis with
 * per-field provenance and review states. Nothing here is a final record —
 * the consultation lands in `awaiting_review` and the professional decides.
 *
 * Guarded, in this order:
 *  - the recording must be uploaded (server-confirmed) and still have audio;
 *  - the patient must have an ACTIVE ai-processing consent (PRD §9.5) —
 *    recording consent alone does not authorize AI processing;
 *  - the consultation must not be finalized (a closed chart takes no AI draft).
 *
 * Runs with whatever client it is given: the Inngest job passes a service-role
 * client; the inline fallback passes the user's client (RLS applies).
 */

export type PipelineResult =
  | { ok: true; transcriptionId: string; answers: number; gaps: number }
  | { ok: false; error: string };

const fail = async (supabase: SupabaseClient, recordingId: string, error: string): Promise<PipelineResult> => {
  await supabase.from("recordings").update({ status: "failed", error }).eq("id", recordingId);
  return { ok: false, error };
};

export async function processRecording(supabase: SupabaseClient, recordingId: string): Promise<PipelineResult> {
  const { data: recording, error: loadError } = await supabase
    .from("recordings")
    .select("id, org_id, patient_id, consultation_id, status, audio_path, mime, created_by")
    .eq("id", recordingId)
    .maybeSingle();

  if (loadError || !recording) return { ok: false, error: loadError?.message ?? "Recording not found." };
  if (!recording.audio_path) return fail(supabase, recordingId, "Recording has no audio.");
  if (!recording.consultation_id) return fail(supabase, recordingId, "Recording is not linked to a consultation.");

  // AI processing is a SEPARATE consent from recording (PRD §9.5).
  const { data: consented } = await supabase.rpc("has_active_consent", {
    target_org: recording.org_id,
    target_patient: recording.patient_id,
    term_slug: "ai-processing",
  });
  if (!consented) return fail(supabase, recordingId, "Patient has no active ai-processing consent.");

  const { data: consultation } = await supabase
    .from("consultations")
    .select("id, status")
    .eq("id", recording.consultation_id)
    .maybeSingle();
  if (!consultation) return fail(supabase, recordingId, "Consultation not found.");
  if (consultation.status === "finalized") {
    return fail(supabase, recordingId, "Consultation is finalized: it takes no AI draft.");
  }

  await supabase.from("recordings").update({ status: "processing", error: null }).eq("id", recordingId);

  // ---- 1. Transcribe (diarized) --------------------------------------------
  const { data: created, error: insertError } = await supabase
    .from("transcriptions")
    .insert({
      org_id: recording.org_id,
      audio_path: recording.audio_path,
      mime: recording.mime ?? "audio/webm",
      created_by: recording.created_by,
      // Audio retention is the practice's choice (PRD §14.3); the transcript
      // is what the record needs, so the default keeps the source for review.
      delete_audio_after: false,
      metadata: { recordingId, consultationId: recording.consultation_id },
    })
    .select("id")
    .single();
  if (insertError || !created)
    return fail(supabase, recordingId, insertError?.message ?? "Could not queue transcription.");

  const transcribed = await processTranscription(supabase, created.id);
  if (!transcribed.ok) return fail(supabase, recordingId, transcribed.error);

  const { data: transcriptionRow } = await supabase
    .from("transcriptions")
    .select("result")
    .eq("id", created.id)
    .maybeSingle();
  const transcript = transcriptionRow?.result as TranscriptResult | null;
  if (!transcript?.segments?.length) {
    return fail(supabase, recordingId, "Transcript is empty — nothing to extract.");
  }

  // ---- 2. Extract the draft anamnesis --------------------------------------
  let extraction;
  try {
    extraction = await extractAnamnesis(transcript);
  } catch (error) {
    return fail(supabase, recordingId, error instanceof Error ? error.message : String(error));
  }

  // ---- 3. Write the draft (never overwriting the professional's own words) --
  const { data: existing } = await supabase
    .from("anamnesis_answers")
    .select("block_key, field_key, source")
    .eq("consultation_id", recording.consultation_id);

  // A value the professional typed herself wins over the AI draft.
  const typedByHand = new Set(
    (existing ?? []).filter((row) => row.source === "professional").map((row) => `${row.block_key}.${row.field_key}`),
  );

  const rows = extraction.answers
    .filter((answer) => !typedByHand.has(`${answer.blockKey}.${answer.fieldKey}`))
    .map((answer) => ({
      org_id: recording.org_id,
      consultation_id: recording.consultation_id,
      block_key: answer.blockKey,
      field_key: answer.fieldKey,
      value: answer.value,
      source: answer.source,
      state: answer.state,
      provenance: { ...answer.provenance, transcriptionId: created.id },
      created_by: recording.created_by,
    }));

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from("anamnesis_answers")
      .upsert(rows, { onConflict: "consultation_id,block_key,field_key" });
    if (upsertError) return fail(supabase, recordingId, upsertError.message);
  }

  // ---- 4. Hand it to the professional --------------------------------------
  await supabase
    .from("consultations")
    .update({
      status: "awaiting_review",
      transcription_id: created.id,
      // Gaps are suggestions to investigate, never answers (PRD §10.7).
      ai_gaps: extraction.gaps,
    })
    .eq("id", recording.consultation_id);

  await supabase.from("recordings").update({ status: "ready", transcription_id: created.id }).eq("id", recordingId);

  return { ok: true, transcriptionId: created.id, answers: rows.length, gaps: extraction.gaps.length };
}
