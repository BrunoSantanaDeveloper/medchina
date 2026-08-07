import { accountArchiveName } from "@/lib/account-export-jobs";
import { recordAudit } from "@/lib/audit";
import { clinicalError } from "@/lib/clinical-route";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";

const BUCKET = "exports";
/** Long enough to start the download, short enough that a leaked URL is dead. */
const SIGNED_URL_SECONDS = 60;

/**
 * Hands over a finished archive.
 *
 * The row is read with HER client, so RLS decides whether this export belongs
 * to a workspace she is a member of; only then does the service role mint a
 * signed URL. The bucket has no policy at all — this route is the only door,
 * which is also what makes the access auditable.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data: row } = await supabase
    .from("account_exports")
    .select("id, org_id, status, file_path, expires_at")
    .eq("id", id)
    .maybeSingle();

  if (!row) return clinicalError("not_found");
  if (row.status !== "ready" || !row.file_path) return clinicalError("invalid_request", { status: row.status });
  if (row.expires_at && new Date(row.expires_at as string).getTime() < Date.now()) {
    return clinicalError("invalid_request", { status: "expired" });
  }

  const service = createServiceClient();
  const { data: signed, error } = await service.storage
    .from(BUCKET)
    .createSignedUrl(row.file_path as string, SIGNED_URL_SECONDS, { download: accountArchiveName() });

  if (error || !signed) return clinicalError("internal_error");

  await service.from("account_exports").update({ last_downloaded_at: new Date().toISOString() }).eq("id", id);
  await recordAudit(supabase, "account.exported", {
    orgId: row.org_id as string,
    entityType: "account_export",
    entityId: id,
  });

  return Response.redirect(signed.signedUrl, 302);
}
