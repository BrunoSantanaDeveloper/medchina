import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { buildTherapeuticPlan, type PlanInput } from "@/lib/therapeutic-plan";
import { getAudioAllowance } from "@/lib/usage";
import { createClient } from "@flyee/auth/server";

// Retrieval + one reasoning call.
export const maxDuration = 120;

/**
 * Prepare a therapeutic-plan DRAFT for a consultation (PRD §10.9, Pro).
 *
 * On demand, like the hypotheses: the plan follows the patterns SHE accepted,
 * so it only makes sense once she has reasoned about the case. It never
 * finalizes anything — validation and signing are separate professional acts
 * (PRD §10.10).
 *
 * Runs with the CALLER's client: RLS is the authorization.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: consultation } = await supabase
    .from("consultations")
    .select("id, org_id, status, chief_complaint")
    .eq("id", id)
    .maybeSingle();
  if (!consultation) return NextResponse.json({ error: "Consultation not found." }, { status: 404 });
  if (consultation.status === "finalized") {
    return NextResponse.json({ error: "consultation_finalized" }, { status: 409 });
  }

  // The plan is the Pro layer (PRD §10.9), gated on the same allowance.
  const allowance = await getAudioAllowance(supabase, consultation.org_id);
  if (!allowance?.clinicalReasoning) {
    return NextResponse.json({ error: "reasoning_not_available" }, { status: 402 });
  }

  // A validated plan is a professional decision — regenerating would erase it.
  // She edits it, or discards the validation first.
  const { data: existing } = await supabase
    .from("consultation_plans")
    .select("id, status")
    .eq("consultation_id", id)
    .maybeSingle();
  if (existing?.status === "validated") {
    return NextResponse.json({ error: "plan_validated" }, { status: 409 });
  }

  const [{ data: answers }, { data: hypotheses }] = await Promise.all([
    supabase.from("anamnesis_answers").select("block_key, field_key, value, source").eq("consultation_id", id),
    // The plan follows the patterns she ACCEPTED or EDITED, never a rejected or
    // still-draft one.
    supabase
      .from("consultation_hypotheses")
      .select("pattern, status")
      .eq("consultation_id", id)
      .in("status", ["accepted", "edited"]),
  ]);

  const input: PlanInput = {
    chiefComplaint: consultation.chief_complaint,
    answers: (answers ?? []).map((row) => ({
      blockKey: row.block_key,
      fieldKey: row.field_key,
      value: row.value,
      source: row.source,
    })),
    acceptedPatterns: (hypotheses ?? []).map((row) => row.pattern as string),
  };

  if (input.answers.length === 0 && !input.chiefComplaint) {
    return NextResponse.json({ error: "nothing_recorded" }, { status: 422 });
  }

  let result;
  try {
    result = await buildTherapeuticPlan(supabase, input);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  const row = {
    org_id: consultation.org_id,
    consultation_id: id,
    objective: result.objective,
    modalities: result.modalities,
    safety_flags: result.safetyFlags,
    sources: result.sources,
    status: "draft" as const,
    model: result.model,
    prompt_version: result.promptVersion,
    created_by: user.id,
    // A regenerate clears a prior validation stamp (it is a fresh draft).
    validated_by: null,
    validated_at: null,
  };

  const { error: upsertError } = await supabase
    .from("consultation_plans")
    .upsert(row, { onConflict: "consultation_id" });
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  recordAudit(supabase, "consultation.plan.prepared", {
    orgId: consultation.org_id,
    entityType: "consultation",
    entityId: id,
    metadata: {
      modalities: Object.keys(result.modalities),
      safetyFlags: result.safetyFlags.map((f) => f.category),
      model: result.model,
      promptVersion: result.promptVersion,
    },
  });

  return NextResponse.json({
    modalities: Object.keys(result.modalities).length,
    safetyFlags: result.safetyFlags.length,
    retrieved: result.retrieved,
  });
}
