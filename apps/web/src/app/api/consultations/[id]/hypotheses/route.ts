import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { buildHypotheses, type RecordedCase } from "@/lib/clinical-reasoning";
import { getAudioAllowance } from "@/lib/usage";
import { createClient } from "@flyee/auth/server";

// Retrieval + one reasoning call.
export const maxDuration = 120;

/**
 * Prepare disharmony-pattern hypotheses for a consultation (PRD §10.8, Pro).
 *
 * ON DEMAND, deliberately — not a step of the recording pipeline. A pattern is
 * read from the tongue and the pulse, and those are the professional's own
 * observations: the AI must never infer them from the patient's speech (PRD
 * §10.3), so they only exist once SHE has examined and written them. Generating
 * at transcription time would therefore produce a systematically limited draft
 * every single time. She asks for it when the record is ready to be reasoned
 * about — which is also the product's stance everywhere else: the AI prepares,
 * she decides.
 *
 * Runs entirely with the CALLER's client: RLS is the authorization (only a
 * member reads the consultation, the library and writes its hypotheses), so no
 * service-role escalation is needed to do a member's own work.
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
    .select("id, org_id, patient_id, status, chief_complaint")
    .eq("id", id)
    .maybeSingle();
  if (!consultation) return NextResponse.json({ error: "Consultation not found." }, { status: 404 });

  // A finalized record takes no new drafts (PRD §8.5) — the DB guard would
  // refuse anyway; this is the readable answer.
  if (consultation.status === "finalized") {
    return NextResponse.json({ error: "consultation_finalized" }, { status: 409 });
  }

  // Reasoning is the Pro layer (PRD §5.5/§5.6); the trial is Pro too.
  const allowance = await getAudioAllowance(supabase, consultation.org_id);
  if (!allowance?.clinicalReasoning) {
    return NextResponse.json({ error: "reasoning_not_available" }, { status: 402 });
  }

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

  if (recorded.answers.length === 0 && !recorded.chiefComplaint) {
    return NextResponse.json({ error: "nothing_recorded" }, { status: 422 });
  }

  let result;
  try {
    result = await buildHypotheses(supabase, recorded);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  // Re-preparing replaces the DRAFTS only. Anything she already accepted,
  // edited or rejected is her decision and survives untouched (PRD §10.10).
  await supabase.from("consultation_hypotheses").delete().eq("consultation_id", id).eq("status", "draft");

  if (result.hypotheses.length > 0) {
    const { error: insertError } = await supabase.from("consultation_hypotheses").insert(
      result.hypotheses.map((hypothesis) => ({
        org_id: consultation.org_id,
        consultation_id: id,
        pattern: hypothesis.pattern,
        rationale: hypothesis.rationale,
        correspondence: hypothesis.correspondence,
        supporting_signs: hypothesis.supportingSigns,
        contradicting_signs: hypothesis.contradictingSigns,
        missing_data: hypothesis.missingData,
        sources: hypothesis.sources,
        limitation: hypothesis.limitation,
        status: "draft",
        // What produced this (PRD §10.10).
        model: result.model,
        prompt_version: result.promptVersion,
        created_by: user.id,
      })),
    );
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  recordAudit(supabase, "consultation.hypotheses.prepared", {
    orgId: consultation.org_id,
    entityType: "consultation",
    entityId: id,
    metadata: {
      count: result.hypotheses.length,
      model: result.model,
      promptVersion: result.promptVersion,
      sourcesRetrieved: result.retrieved,
    },
  });

  return NextResponse.json({ count: result.hypotheses.length, retrieved: result.retrieved });
}
