import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { createServiceClient } from "@flyee/auth/service";

const BUCKET = "clinical-attachments";

type ConfirmBody = { path?: unknown; size?: unknown };

/** Confirm an upload landed at its reserved path — flips the row to 'ready'. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as ConfirmBody;
  if (typeof body.path !== "string") return clinicalError("invalid_request");
  const size = typeof body.size === "number" && Number.isFinite(body.size) ? Math.round(body.size) : null;

  const { data, error } = await supabase.rpc("confirm_consultation_attachment", {
    target_attachment: attachmentId,
    target_path: body.path,
    target_size: size,
    target_checksum: null,
  });
  if (error) return clinicalError("internal_error");
  const result = data as { ok?: boolean; code?: string } | null;
  if (result?.ok) {
    await recordAudit(supabase, "consultation.attachment.added", {
      entityType: "consultation",
      entityId: id,
      metadata: { attachmentId },
    });
  }
  return clinicalRpcResponse(result);
}

/** Soft-delete the attachment and remove its storage object. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data, error } = await supabase.rpc("delete_consultation_attachment", { target_attachment: attachmentId });
  if (error) return clinicalError("internal_error");
  const result = data as { ok?: boolean; code?: string; storagePath?: string } | null;
  if (!result?.ok) return clinicalRpcResponse(result);

  // The row is soft-deleted (auditable); the object is removed for real.
  if (typeof result.storagePath === "string" && result.storagePath) {
    await createServiceClient()
      .storage.from(BUCKET)
      .remove([result.storagePath])
      .catch(() => undefined);
  }
  await recordAudit(supabase, "consultation.attachment.deleted", {
    entityType: "consultation",
    entityId: id,
    metadata: { attachmentId },
  });
  return Response.json({ ok: true });
}
