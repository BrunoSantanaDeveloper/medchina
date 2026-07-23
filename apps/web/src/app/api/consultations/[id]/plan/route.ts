import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { buildTherapeuticPlan, type PlanInput } from "@/lib/therapeutic-plan";
import { getAudioAllowance } from "@/lib/usage";
import { createServiceClient } from "@flyee/auth/service";

export const maxDuration = 120;

type PrepareBody = { replaceManual?: boolean };
type SaveBody = {
  planId?: string;
  objective?: string;
  modalities?: Record<string, unknown>;
  safetyFlags?: unknown[];
  expectedUpdatedAt?: string;
};
type ValidateBody = {
  planId?: string;
  expectedUpdatedAt?: string;
  acknowledgeSafety?: boolean;
};

/** Generate a stale-safe draft only from hypotheses the professional settled. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");
  const body = (await request.json().catch(() => ({}))) as PrepareBody;

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

  const { data: existing } = await supabase
    .from("consultation_plans")
    .select("id, status, origin")
    .eq("consultation_id", id)
    .maybeSingle();
  if (existing?.status === "validated") return clinicalError("plan_validated");
  if (existing?.origin === "manual" && body.replaceManual !== true) return clinicalError("manual_plan_exists");

  const [{ data: answers }, { data: hypotheses }, { data: profile }] = await Promise.all([
    supabase.from("anamnesis_answers").select("block_key, field_key, value, source").eq("consultation_id", id),
    supabase
      .from("consultation_hypotheses")
      .select("id, pattern, status, updated_at")
      .eq("consultation_id", id)
      .in("status", ["accepted", "edited"]),
    // Her declared practice bounds what the plan may propose (PRD §10.9): a
    // protocol she does not practise is noise she must review, and a validated
    // plan is signed into a document under her professional responsibility.
    supabase.from("profiles").select("practice_modalities").eq("id", user.id).maybeSingle(),
  ]);
  if (!hypotheses?.length) return clinicalError("accepted_hypothesis_required");

  const input: PlanInput = {
    chiefComplaint: consultation.chief_complaint,
    answers: (answers ?? []).map((row) => ({
      blockKey: row.block_key,
      fieldKey: row.field_key,
      value: row.value,
      source: row.source,
    })),
    acceptedPatterns: hypotheses.map((row) => row.pattern as string),
    practiceModalities: (profile?.practice_modalities as string[] | null) ?? [],
  };
  if (input.answers.length === 0 && !input.chiefComplaint) return clinicalError("nothing_recorded");

  let result;
  try {
    result = await buildTherapeuticPlan(supabase, input);
  } catch {
    return clinicalError("provider_unavailable");
  }

  const basis = hypotheses.map((hypothesis) => ({
    id: hypothesis.id,
    pattern: hypothesis.pattern,
    status: hypothesis.status,
    updatedAt: hypothesis.updated_at,
  }));
  const { data: savedData, error: savedError } = await createServiceClient().rpc("save_generated_consultation_plan", {
    target_consultation: id,
    expected_revision: consultation.clinical_revision,
    target_objective: result.objective,
    target_modalities: result.modalities,
    target_safety_flags: result.safetyFlags,
    target_sources: result.sources,
    target_basis_hypotheses: basis,
    target_model: result.model,
    target_prompt_version: result.promptVersion,
    target_actor: user.id,
    replace_manual: body.replaceManual === true,
  });
  if (savedError) return clinicalError("internal_error");
  const saved = savedData as { ok?: boolean; planId?: string; code?: string } | null;
  if (!saved?.ok) return clinicalRpcResponse(saved);

  await recordAudit(supabase, "consultation.plan.prepared", {
    orgId: consultation.org_id,
    entityType: "consultation_plan",
    entityId: saved.planId,
    metadata: {
      consultationId: id,
      modalities: Object.keys(result.modalities),
      practiceScope: result.scope,
      safetyFlags: result.safetyFlags.map((flag) => flag.category),
      model: result.model,
      promptVersion: result.promptVersion,
      inputRevision: consultation.clinical_revision,
      basisHypotheses: basis.map((hypothesis) => hypothesis.id),
    },
  });

  return Response.json({
    ok: true,
    planId: saved.planId,
    modalities: Object.keys(result.modalities).length,
    safetyFlags: result.safetyFlags.length,
    retrieved: result.retrieved,
  });
}

/** Save manual edits; any content change invalidates a prior validation. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as SaveBody;
  if (!body.planId || typeof body.objective !== "string" || !body.modalities) {
    return clinicalError("invalid_request");
  }
  const { data, error } = await supabase.rpc("save_consultation_plan", {
    target_plan: body.planId,
    target_objective: body.objective,
    target_modalities: body.modalities,
    target_safety_flags: Array.isArray(body.safetyFlags) ? body.safetyFlags : null,
    expected_updated_at: body.expectedUpdatedAt ?? null,
  });
  if (error) return clinicalError("internal_error");
  const result = data as { ok?: boolean } | null;
  if (result?.ok) {
    await recordAudit(supabase, "consultation.plan.saved", {
      entityType: "consultation_plan",
      entityId: body.planId,
      metadata: { consultationId: id },
    });
  }
  return clinicalRpcResponse(result);
}

/** Validation is an explicit professional action over the current plan. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as ValidateBody;
  if (!body.planId || !body.expectedUpdatedAt) return clinicalError("invalid_request");
  const { data, error } = await supabase.rpc("validate_consultation_plan", {
    target_plan: body.planId,
    expected_updated_at: body.expectedUpdatedAt,
    acknowledge_safety: body.acknowledgeSafety === true,
    target_validation_context: { consultationId: id, method: "web_confirmation" },
  });
  if (error) return clinicalError("internal_error");
  const result = data as { ok?: boolean } | null;
  if (result?.ok) {
    await recordAudit(supabase, "consultation.plan.validated", {
      entityType: "consultation_plan",
      entityId: body.planId,
      metadata: { consultationId: id, safetyAcknowledged: body.acknowledgeSafety === true },
    });
  }
  return clinicalRpcResponse(result);
}
