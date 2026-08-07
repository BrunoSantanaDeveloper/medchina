import { getTranslations } from "next-intl/server";

import { runAccountExport } from "@/lib/account-export-jobs";
import { recordAudit } from "@/lib/audit";
import { clinicalError } from "@/lib/clinical-route";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import { sendEvent } from "@flyee/jobs";

// Assembling every chart of a practice; the background job is the normal path.
export const maxDuration = 300;

/**
 * Request a full-practice export (PRD §9.10, docs/IMPORT-EXPORT.md item 6).
 *
 * Gated on nothing but membership — same rule as the per-patient export: a
 * plan, an unpaid invoice or an exhausted cycle never stand between her and
 * her own records.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data, error } = await supabase.rpc("request_account_export");
  if (error) return clinicalError("internal_error");

  const payload = (data ?? {}) as { ok?: boolean; code?: string; exportId?: string; orgId?: string };
  if (payload.ok !== true) return clinicalError(payload.code === "not_found" ? "not_found" : "invalid_request");

  // Already in flight: hand back the same request instead of queueing a second
  // pass over the whole database.
  if (payload.code === "already_running") {
    return Response.json({ ok: true, code: "already_running", exportId: payload.exportId }, { status: 200 });
  }

  const t = await getTranslations("product");
  const notes = {
    exportId: payload.exportId as string,
    scopeNote: t("account-export-scope-note"),
    readmeTitle: t("account-export-readme-title"),
    readyTitle: t("account-export-ready-title"),
    readyBody: t("account-export-ready-body"),
  };

  await recordAudit(supabase, "account.export_requested", {
    orgId: payload.orgId ?? null,
    entityType: "account_export",
    entityId: payload.exportId,
  });

  const queued = await sendEvent("medchina/account.export", notes);
  if (queued.sent) {
    return Response.json({ ok: true, code: "queued", exportId: payload.exportId }, { status: 202 });
  }

  // Inline fallback (local dev, or missing Inngest keys) — bounded by
  // maxDuration above, which a very large practice can still exceed. The row
  // then stays `running` and the retention job eventually clears it; the UI
  // says what state it is in rather than pretending it finished.
  const result = await runAccountExport(createServiceClient(), notes);
  return Response.json(
    { ok: result.ok, code: result.ok ? "ready" : "failed", exportId: payload.exportId },
    {
      status: result.ok ? 200 : 500,
    },
  );
}
