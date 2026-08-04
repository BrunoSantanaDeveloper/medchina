import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { buildClinicalSummary, type SummaryInput } from "@/lib/clinical-summary";
import { getAudioAllowance } from "@/lib/usage";
import { createServiceClient } from "@flyee/auth/service";

export const maxDuration = 120;

/**
 * Generate (or refresh) the AI-suggested clinical summary for review. Writes
 * ONLY `ai_summary` — never her `summary`. Pro-gated + ai-processing consent.
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

  const { data: aiConsent } = await supabase.rpc("has_active_consent", {
    target_org: consultation.org_id,
    target_patient: consultation.patient_id,
    term_slug: "ai-processing",
  });
  if (!aiConsent) return clinicalError("ai_consent_required");

  const { data: answers } = await supabase
    .from("anamnesis_answers")
    .select("block_key, field_key, value")
    .eq("consultation_id", id);
  const input: SummaryInput = {
    chiefComplaint: consultation.chief_complaint,
    answers: (answers ?? []).map((row) => ({ blockKey: row.block_key, fieldKey: row.field_key, value: row.value })),
  };
  if (input.answers.length === 0 && !input.chiefComplaint) return clinicalError("nothing_recorded");

  let result;
  try {
    result = await buildClinicalSummary(input);
  } catch (error) {
    console.error("[summary] provider call failed", error);
    return clinicalError("provider_unavailable");
  }

  const { data, error } = await createServiceClient().rpc("save_consultation_ai_summary", {
    target_consultation: id,
    target_summary: result.summary,
    target_model: result.model,
    target_prompt_version: result.promptVersion,
  });
  if (error) return clinicalError("internal_error");
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
