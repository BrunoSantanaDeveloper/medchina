import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { buildClinicalSummary, type SummaryInput } from "@/lib/clinical-summary";
import { getAudioAllowance } from "@/lib/usage";
import { clinicalProviderCode, describeAiFailure } from "@flyee/ai";
import { createServiceClient } from "@flyee/auth/service";

export const maxDuration = 120;

/**
 * Generate (or refresh) the AI-suggested clinical summary for review. Writes
 * ONLY `ai_summary` — never her `summary`. Pro-gated; no consent needed to
 * reread the record, but a patient who refused AI is respected (0102).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data: consultation } = await supabase
    .from("consultations")
    .select("id, org_id, patient_id, status, chief_complaint")
    .eq("id", id)
    .maybeSingle();
  if (!consultation) return clinicalError("not_found");
  if (!["draft", "in_progress", "awaiting_review"].includes(consultation.status)) {
    return clinicalError("consultation_finalized");
  }

  const allowance = await getAudioAllowance(supabase, consultation.org_id);
  if (!allowance?.clinicalReasoning) return clinicalError("reasoning_not_available");

  // Reasoning over what is already in the record does not need a second
  // authorization: 'ai-processing' authorizes CAPTURING the consultation —
  // recording her voice, sending the audio out to be transcribed. What this
  // does need is that the patient has not said NO (refused on her own device
  // or revoked): patient_refused_ai_reasoning, migration 0102.
  const { data: aiRefused } = await supabase.rpc("patient_refused_ai_reasoning", {
    target_org: consultation.org_id,
    target_patient: consultation.patient_id,
  });
  if (aiRefused) return clinicalError("ai_consent_refused");

  const { data: answers } = await supabase
    .from("anamnesis_answers")
    .select("block_key, field_key, value, state")
    // A draft she REJECTED is not part of the record it was rejected from.
    // Rejections since 0059 delete the row, but rows from before it survive
    // with state='rejected' — reading without this filter is how discarded
    // clinical content walks back into a summary she applies with one click.
    .neq("state", "rejected")
    .eq("consultation_id", id);
  const input: SummaryInput = {
    chiefComplaint: consultation.chief_complaint,
    answers: (answers ?? []).map((row) => ({
      blockKey: row.block_key,
      fieldKey: row.field_key,
      value: row.value,
      state: row.state,
    })),
  };
  if (input.answers.length === 0 && !input.chiefComplaint) return clinicalError("nothing_recorded");

  let result;
  try {
    result = await buildClinicalSummary(input, {
      orgId: consultation.org_id,
      refId: consultation.id,
      client: supabase,
    });
  } catch (error) {
    // Logged without the model's text (it is the patient's record), and mapped
    // to the code that says whether trying again can help.
    console.error("[summary] provider call failed", describeAiFailure(error));
    return clinicalError(clinicalProviderCode(error));
  }

  // Inside a try: `createServiceClient()` THROWS when the service-role key is
  // absent, and a throw here escaped as a bare 500 with no JSON body — which the
  // panel could only render as its generic "tente novamente", hiding the cause
  // from the professional AND from us.
  let data;
  try {
    const saved = await createServiceClient().rpc("save_consultation_ai_summary", {
      target_consultation: id,
      target_summary: result.summary,
      target_model: result.model,
      target_prompt_version: result.promptVersion,
    });
    if (saved.error) {
      console.error("[summary] save failed", saved.error);
      return clinicalError("internal_error");
    }
    data = saved.data;
  } catch (cause) {
    console.error("[summary] service client unavailable", cause);
    return clinicalError("internal_error");
  }
  const saved = data as { ok?: boolean; code?: string } | null;
  if (!saved?.ok) return clinicalRpcResponse(saved);

  await recordAudit(supabase, "consultation.ai_summary.generated", {
    orgId: consultation.org_id,
    entityType: "consultation",
    entityId: id,
    metadata: { model: result.model, promptVersion: result.promptVersion },
  });

  return Response.json({ ok: true, summary: result.summary, updatedAt: new Date().toISOString() });
}
