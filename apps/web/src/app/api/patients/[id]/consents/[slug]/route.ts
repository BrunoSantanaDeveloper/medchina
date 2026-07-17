import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";

const ALLOWED_SLUGS = new Set(["audio-recording", "ai-processing", "clinical-images"]);
const ALLOWED_METHODS = new Set(["verbal", "in_person"]);
type ConsentBody = { granted?: boolean; method?: string; consultationId?: string };

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id, slug } = await params;
  if (!ALLOWED_SLUGS.has(slug)) return clinicalError("invalid_request");

  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as ConsentBody;
  if (typeof body.granted !== "boolean") return clinicalError("invalid_request");
  if (body.granted && !ALLOWED_METHODS.has(body.method ?? "")) return clinicalError("invalid_request");

  const metadata = {
    method: body.granted ? body.method : "professional_revocation",
    ...(typeof body.consultationId === "string" && /^[0-9a-f-]{36}$/i.test(body.consultationId)
      ? { consultationId: body.consultationId }
      : {}),
  };
  const { data, error } = await supabase.rpc("set_patient_consent", {
    target_patient: id,
    target_slug: slug,
    target_granted: body.granted,
    target_metadata: metadata,
  });
  if (error) return clinicalError("internal_error");

  const result = data as { ok?: boolean } | null;
  if (result?.ok) {
    const { data: patient } = await supabase.from("patients").select("org_id").eq("id", id).maybeSingle();
    await recordAudit(supabase, body.granted ? "consent.granted" : "consent.revoked", {
      orgId: patient?.org_id,
      entityType: "patient",
      entityId: id,
      metadata: { slug, method: metadata.method },
    });
  }
  return clinicalRpcResponse(data);
}
