import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { buildClinicalSummary } from "@/lib/clinical-summary";
import { openConversionOffer } from "@/lib/conversion-offer";
import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { getGaClientId, getMetaClientContext } from "@/lib/meta-capi-context";
import { getAudioAllowance } from "@/lib/usage";

// Finalizing must never hang on the AI summary: the summary is best-effort
// and time-boxed below; this cap is for everything else in the route.
export const maxDuration = 120;

type FinalizeBody = { expectedRevision?: number | null; acknowledgedWarnings?: string[] };

/**
 * Generate the AI summary ONCE, at the end — over ALL recordings joined into
 * the anamnesis (not per recording). Runs BEFORE the freeze, while the record
 * is still editable, so the RPC accepts the write. Best-effort and Pro-gated;
 * a failure never blocks finalization.
 */
async function generateFinalSummary(
  supabase: Awaited<ReturnType<typeof createClinicalRequestClient>>,
  consultationId: string,
): Promise<void> {
  try {
    const { data: consultation } = await supabase
      .from("consultations")
      .select("org_id, patient_id, status, chief_complaint")
      .eq("id", consultationId)
      .maybeSingle();
    if (!consultation || !["draft", "in_progress", "awaiting_review"].includes(consultation.status)) return;

    const allowance = await getAudioAllowance(supabase, consultation.org_id);
    if (!allowance?.clinicalReasoning) return;
    // Reasoning over what is already in the record does not need a second
    // authorization: 'ai-processing' authorizes CAPTURING the consultation —
    // recording her voice, sending the audio out to be transcribed. What this
    // does need is that the patient has not said NO (refused on her own device
    // or revoked): patient_refused_ai_reasoning, migration 0102.
    const { data: aiRefused } = await supabase.rpc("patient_refused_ai_reasoning", {
      target_org: consultation.org_id,
      target_patient: consultation.patient_id,
    });
    if (aiRefused) return;

    const { data: answers } = await supabase
      .from("anamnesis_answers")
      .select("block_key, field_key, value, state")
      // Same filter as the on-demand summary: content she rejected is not part
      // of the record, and this summary is the one that freezes with it.
      .neq("state", "rejected")
      .eq("consultation_id", consultationId);
    if ((answers ?? []).length === 0 && !consultation.chief_complaint) return;

    // TIME-BOXED: the professional clicked "finalize" — closing the record is
    // the job, the suggested summary is a bonus. A hung provider used to hold
    // this route open until the platform killed it, which read as "the
    // consultation will not finalize".
    const suggested = await Promise.race([
      buildClinicalSummary({
        chiefComplaint: consultation.chief_complaint,
        answers: (answers ?? []).map((row) => ({
          blockKey: row.block_key,
          fieldKey: row.field_key,
          value: row.value,
          state: row.state,
        })),
      }),
      new Promise<never>((_, rejectRace) =>
        setTimeout(() => rejectRace(new Error("final summary timed out — finalization proceeds without it")), 45_000),
      ),
    ]);
    if (!suggested.summary) return;

    await supabase.rpc("save_consultation_ai_summary", {
      target_consultation: consultationId,
      target_summary: suggested.summary,
      target_model: suggested.model,
      target_prompt_version: suggested.promptVersion,
    });
  } catch {
    // Best-effort — the suggestion never blocks closing the record.
  }
}

/**
 * MedChina's activation aha (lib/onboarding.ts) is the FIRST finalized manual
 * consultation. Fires a server-side `Activated` conversion the one time an org
 * reaches it — never a browser tracker (this is a clinical route, LGPD Art. 11)
 * and NO clinical data: only the hashed org id + the professional's own match
 * keys. Best-effort; never blocks finalization.
 */
async function reportActivationIfFirst(
  supabase: Awaited<ReturnType<typeof createClinicalRequestClient>>,
  consultationId: string,
  requestUrl: string,
  email: string | undefined,
): Promise<void> {
  try {
    const { data: consult } = await supabase
      .from("consultations")
      .select("org_id, status")
      .eq("id", consultationId)
      .maybeSingle();
    if (consult?.status !== "finalized" || !consult.org_id) return;

    const { count } = await supabase
      .from("consultations")
      .select("id", { count: "exact", head: true })
      .eq("org_id", consult.org_id)
      .eq("status", "finalized");
    if (count !== 1) return; // Only the very first finalized consultation.

    const [metaContext, gaClientId] = await Promise.all([
      getMetaClientContext(`${new URL(requestUrl).origin}/inicio`),
      getGaClientId(),
    ]);
    await sendMetaConversion({
      eventName: "Activated",
      eventId: `activated:${consult.org_id}`,
      email,
      externalId: consult.org_id,
      ...metaContext,
    });
    await sendGa4Event({ clientId: gaClientId, eventName: "activated", eventId: `activated:${consult.org_id}` });

    // The same instant, used commercially: she has just watched the product do
    // the thing it promised, on a real patient. Waiting for the calendar drip
    // to ask (day 11) means asking someone who has already moved on
    // (migration 0088, docs/FUNIL.md).
    await openConversionOffer(supabase, consult.org_id, "first_consultation");
  } catch {
    // Measurement is best-effort — a finalized consultation is already committed.
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as FinalizeBody;
  const expectedRevision = Number.isInteger(body.expectedRevision) ? Number(body.expectedRevision) : null;
  const acknowledgedWarnings = Array.isArray(body.acknowledgedWarnings)
    ? body.acknowledgedWarnings.filter((value): value is string => typeof value === "string")
    : [];

  // Generate the AI summary BEFORE finalizing — the record must still be
  // editable for the write to land. Best-effort: never blocks the close.
  await generateFinalSummary(supabase, id);

  const { data, error } = await supabase.rpc("finalize_consultation", {
    target_consultation: id,
    expected_revision: expectedRevision,
    acknowledged_warnings: acknowledgedWarnings,
  });
  if (error) return clinicalError("internal_error");

  await reportActivationIfFirst(supabase, id, request.url, user.email);

  return clinicalRpcResponse(data);
}
