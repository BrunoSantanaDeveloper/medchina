import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { buildClinicalSummary } from "@/lib/clinical-summary";
import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { getGaClientId, getMetaClientContext } from "@/lib/meta-capi-context";
import { getAudioAllowance } from "@/lib/usage";

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
    const { data: aiConsent } = await supabase.rpc("has_active_consent", {
      target_org: consultation.org_id,
      target_patient: consultation.patient_id,
      term_slug: "ai-processing",
    });
    if (!aiConsent) return;

    const { data: answers } = await supabase
      .from("anamnesis_answers")
      .select("block_key, field_key, value")
      .eq("consultation_id", consultationId);
    if ((answers ?? []).length === 0 && !consultation.chief_complaint) return;

    const suggested = await buildClinicalSummary({
      chiefComplaint: consultation.chief_complaint,
      answers: (answers ?? []).map((row) => ({ blockKey: row.block_key, fieldKey: row.field_key, value: row.value })),
    });
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
