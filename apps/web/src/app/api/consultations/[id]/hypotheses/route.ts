import { recordAudit } from "@/lib/audit";
import { buildHypotheses, type RecordedCase } from "@/lib/clinical-reasoning";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { getAudioAllowance } from "@/lib/usage";
import { createServiceClient } from "@flyee/auth/service";

export const maxDuration = 120;

/** Prepare stale-safe draft hypotheses from one immutable clinical revision. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data: consultation } = await supabase
    .from("consultations")
    .select("id, org_id, status, chief_complaint, clinical_revision")
    .eq("id", id)
    .maybeSingle();
  if (!consultation) return clinicalError("not_found");
  if (!["draft", "in_progress", "awaiting_review"].includes(consultation.status)) {
    return clinicalError("consultation_finalized");
  }

  const allowance = await getAudioAllowance(supabase, consultation.org_id);
  if (!allowance?.clinicalReasoning) return clinicalError("reasoning_not_available");

  const { data: answers } = await supabase
    .from("anamnesis_answers")
    .select("block_key, field_key, value, source, state")
    .eq("consultation_id", id);
  const recorded: RecordedCase = {
    chiefComplaint: consultation.chief_complaint,
    answers: (answers ?? []).map((row) => ({
      blockKey: row.block_key,
      fieldKey: row.field_key,
      value: row.value,
      source: row.source,
      state: row.state,
    })),
  };
  if (recorded.answers.length === 0 && !recorded.chiefComplaint) return clinicalError("nothing_recorded");

  let result;
  try {
    result = await buildHypotheses(supabase, recorded);
  } catch {
    return clinicalError("provider_unavailable");
  }

  const { data: replaceData, error: replaceError } = await createServiceClient().rpc("replace_draft_hypotheses", {
    target_consultation: id,
    expected_revision: consultation.clinical_revision,
    target_hypotheses: result.hypotheses.map((hypothesis) => ({
      pattern: hypothesis.pattern,
      rationale: hypothesis.rationale,
      correspondence: hypothesis.correspondence,
      supportingSigns: hypothesis.supportingSigns,
      contradictingSigns: hypothesis.contradictingSigns,
      missingData: hypothesis.missingData,
      sources: hypothesis.sources,
      limitation: hypothesis.limitation,
    })),
    target_model: result.model,
    target_prompt_version: result.promptVersion,
    target_actor: user.id,
  });
  if (replaceError) return clinicalError("internal_error");
  const replaced = replaceData as { ok?: boolean; count?: number; code?: string } | null;
  if (!replaced?.ok) return clinicalRpcResponse(replaced);

  await recordAudit(supabase, "consultation.hypotheses.prepared", {
    orgId: consultation.org_id,
    entityType: "consultation",
    entityId: id,
    metadata: {
      count: replaced.count ?? 0,
      model: result.model,
      promptVersion: result.promptVersion,
      sourcesRetrieved: result.retrieved,
      inputRevision: consultation.clinical_revision,
    },
  });

  return Response.json({ ok: true, count: replaced.count ?? 0, retrieved: result.retrieved });
}
