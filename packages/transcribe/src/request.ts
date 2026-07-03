import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEvent } from "@gogo/jobs";

import { processTranscription } from "./transcribe";

export interface TranscriptionRequest {
  orgId: string;
  /** Path inside the "transcriptions" bucket (upload first: <org_id>/...). */
  audioPath: string;
  mime: string;
  createdBy: string;
  /** Remove the source audio as soon as the transcript is ready. */
  deleteAudioAfter?: boolean;
  metadata?: Record<string, unknown>;
}

export type RequestTranscriptionResult =
  | { ok: true; transcriptionId: string; queued: boolean }
  | { ok: false; error: string };

/**
 * Create the transcription row (RLS: org member) and queue the Inngest
 * job, falling back to inline processing when the event cannot be sent.
 */
export async function requestTranscription(
  supabase: SupabaseClient,
  request: TranscriptionRequest,
): Promise<RequestTranscriptionResult> {
  const { data: created, error } = await supabase
    .from("transcriptions")
    .insert({
      org_id: request.orgId,
      audio_path: request.audioPath,
      mime: request.mime,
      created_by: request.createdBy,
      delete_audio_after: request.deleteAudioAfter ?? false,
      metadata: request.metadata ?? {},
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Insert failed." };

  const queued = await sendEvent("transcribe/audio.transcribe", { transcriptionId: created.id });
  if (queued.sent) return { ok: true, transcriptionId: created.id, queued: true };

  const result = await processTranscription(supabase, created.id);
  return result.ok
    ? { ok: true, transcriptionId: created.id, queued: false }
    : { ok: false, error: result.error };
}
