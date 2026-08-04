import { attachmentExtension, attachmentKindForMime } from "@/lib/attachment-mime";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { createServiceClient } from "@flyee/auth/service";

const BUCKET = "clinical-attachments";

type ReserveBody = { mime?: unknown };

/**
 * Reserve an attachment and hand back a signed upload URL scoped to its exact
 * object path. The kind (image vs document) is DERIVED from the MIME, so a
 * photo always lands as an image (and is consent-gated in the RPC).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as ReserveBody;
  const mime = typeof body.mime === "string" ? body.mime : "";
  const kind = attachmentKindForMime(mime);
  if (!kind) return clinicalError("invalid_request");

  const { data, error } = await supabase.rpc("reserve_consultation_attachment", {
    target_consultation: id,
    target_kind: kind,
    target_mime: mime,
    target_source: "web",
  });
  if (error) return clinicalError("internal_error");
  const result = data as { ok?: boolean; code?: string; attachmentId?: string; orgId?: string } | null;
  if (!result?.ok || !result.attachmentId || !result.orgId) return clinicalRpcResponse(result);

  const path = `${result.orgId}/${id}/${result.attachmentId}.${attachmentExtension(mime)}`;
  const { data: signed, error: signError } = await createServiceClient()
    .storage.from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (signError || !signed) return clinicalError("provider_unavailable");

  return Response.json({ ok: true, attachmentId: result.attachmentId, kind, path, token: signed.token });
}

/** Ready attachments for this consultation, each with a short-lived view URL. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data, error } = await supabase
    .from("consultation_attachments")
    .select("id, kind, mime, storage_path, size_bytes, caption, source, created_at, analysis, analysis_status")
    .eq("consultation_id", id)
    .eq("status", "ready")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return clinicalError("internal_error");

  const service = createServiceClient();
  const attachments = await Promise.all(
    (data ?? []).map(async (row) => {
      let url: string | null = null;
      if (row.storage_path) {
        const { data: signed } = await service.storage.from(BUCKET).createSignedUrl(row.storage_path, 300);
        url = signed?.signedUrl ?? null;
      }
      return {
        id: row.id,
        kind: row.kind,
        mime: row.mime,
        sizeBytes: row.size_bytes,
        caption: row.caption,
        source: row.source,
        createdAt: row.created_at,
        url,
        analysis: row.analysis_status === "ready" ? row.analysis : null,
      };
    }),
  );
  return Response.json({ ok: true, attachments });
}
