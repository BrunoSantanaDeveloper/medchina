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
    .select("id, org_id, patient_id, status, chief_complaint, clinical_revision")
    .eq("id", id)
    .maybeSingle();
  if (!consultation) return clinicalError("not_found");
  if (!["draft", "in_progress", "awaiting_review"].includes(consultation.status)) {
    return clinicalError("consultation_finalized");
  }

  const allowance = await getAudioAllowance(supabase, consultation.org_id);
  if (!allowance?.clinicalReasoning) return clinicalError("reasoning_not_available");

  // Everything the reasoning is allowed to see, gathered in one round trip.
  // `patient` and the decided hypotheses were previously fetched only by the
  // PANEL, so the professional could read her own history while the model that
  // wrote the hypotheses could not.
  const [answersResult, patientResult, decidedResult, priorResult] = await Promise.all([
    supabase
      .from("anamnesis_answers")
      .select("block_key, field_key, value, source, state")
      // A draft she rejected is not part of the record it was rejected from.
      .neq("state", "rejected")
      .eq("consultation_id", id),
    supabase.from("patients").select("birth_date").eq("id", consultation.patient_id).maybeSingle(),
    supabase
      .from("consultation_hypotheses")
      .select("pattern, status")
      .eq("consultation_id", id)
      .eq("status", "rejected"),
    supabase
      .from("consultation_hypotheses")
      .select("pattern, status, consultations!inner(patient_id)")
      .eq("consultations.patient_id", consultation.patient_id)
      .neq("consultation_id", id)
      .in("status", ["accepted", "edited"])
      .limit(10),
  ]);

  const birthDate = patientResult.data?.birth_date as string | null | undefined;
  const ageYears = birthDate ? Math.floor((Date.now() - new Date(birthDate).getTime()) / 31_557_600_000) : null;

  const recorded: RecordedCase = {
    chiefComplaint: consultation.chief_complaint,
    answers: (answersResult.data ?? []).map((row) => ({
      blockKey: row.block_key,
      fieldKey: row.field_key,
      value: row.value,
      source: row.source,
      state: row.state,
    })),
    ageYears: Number.isFinite(ageYears) ? ageYears : null,
    priorPatterns: [...new Set((priorResult.data ?? []).map((row) => row.pattern as string))],
    rejectedPatterns: [...new Set((decidedResult.data ?? []).map((row) => row.pattern as string))],
  };
  if (recorded.answers.length === 0 && !recorded.chiefComplaint) return clinicalError("nothing_recorded");

  let result;
  try {
    result = await buildHypotheses(supabase, recorded);
  } catch (error) {
    // The real provider error (invalid/restricted key, model access, safety
    // block, empty/invalid output) must never reach a clinical client, but
    // swallowing it silently made this undiagnosable. Log it SERVER-side.
    console.error("[hypotheses] provider call failed", error);
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
      retrievalFailed: result.retrievalFailed,
      inputRevision: consultation.clinical_revision,
    },
  });

  return Response.json({
    ok: true,
    count: replaced.count ?? 0,
    retrieved: result.retrieved,
    // "No sources" and "the library could not be reached" are different facts
    // and the panel must be able to say which one happened.
    retrievalFailed: result.retrievalFailed,
  });
}
