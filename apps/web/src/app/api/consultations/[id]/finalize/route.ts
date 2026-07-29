import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { getGaClientId, getMetaClientContext } from "@/lib/meta-capi-context";

type FinalizeBody = { expectedRevision?: number | null; acknowledgedWarnings?: string[] };

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

  const { data, error } = await supabase.rpc("finalize_consultation", {
    target_consultation: id,
    expected_revision: expectedRevision,
    acknowledged_warnings: acknowledgedWarnings,
  });
  if (error) return clinicalError("internal_error");

  await reportActivationIfFirst(supabase, id, request.url, user.email);

  return clinicalRpcResponse(data);
}
