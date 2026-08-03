import { recordAudit } from "@/lib/audit";
import { createCaptureLinkToken } from "@/lib/capture-link";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";

const TTL_SECONDS = 15 * 60;

/**
 * Issue a short-lived QR capture link for THIS consultation. The raw token is
 * returned once (for the QR the professional shows in the room); only its hash
 * is stored. Generating a new link supersedes any prior active one.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as { mode?: unknown; force?: unknown };
  const mode = body.mode === "ai" ? "ai" : "audio_only";

  const { token, tokenHash } = createCaptureLinkToken();
  const { data, error } = await supabase.rpc("create_capture_link", {
    target_consultation: id,
    target_token_hash: tokenHash,
    target_ttl_seconds: TTL_SECONDS,
    target_mode: mode,
    target_force: body.force === true,
  });
  if (error) return clinicalError("internal_error");
  const result = data as {
    ok?: boolean;
    code?: string;
    sessionId?: string;
    mode?: string;
    expiresAt?: string;
  } | null;
  if (!result?.ok) return clinicalRpcResponse(result);

  await recordAudit(supabase, "recording.capture_link.created", {
    entityType: "consultation",
    entityId: id,
    metadata: { sessionId: result.sessionId, mode },
  });

  const origin = new URL(request.url).origin;
  return Response.json({
    ok: true,
    url: `${origin}/gravar#${token}`,
    mode: result.mode ?? mode,
    expiresAt: result.expiresAt,
  });
}

/** Revoke the active link for this consultation (e.g. "the phone is done"). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data, error } = await supabase.rpc("revoke_capture_link", { target_consultation: id });
  if (error) return clinicalError("internal_error");
  return clinicalRpcResponse(data as { ok?: boolean; code?: string } | null);
}
