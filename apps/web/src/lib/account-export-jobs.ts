import "server-only";

import { accountArchiveName, buildAccountArchive } from "@/lib/account-export";
import { notifyUsers } from "@/lib/notifications";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Packaging a practice, and throwing the package away afterwards
 * (docs/IMPORT-EXPORT.md item 6).
 *
 * Both halves matter equally. The archive is every chart of a practice in
 * plain text: useful for exactly as long as it takes her to download it, and a
 * liability the moment it outlives that.
 */

const BUCKET = "exports";
/** 04:10 UTC — after the import purge, outside the practice day. */
const PURGE_CRON = "10 4 * * *";
const DEFAULT_EXPIRES_HOURS = 72;

export type AccountExportEvent = {
  exportId: string;
  scopeNote: string;
  readmeTitle: string;
  readyTitle: string;
  readyBody: string;
};

async function expiryHours(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from("platform_settings").select("value").eq("key", "account_exports").maybeSingle();
  const configured = Number((data?.value as { expires_hours?: unknown } | null)?.expires_hours);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_EXPIRES_HOURS;
}

export async function runAccountExport(supabase: SupabaseClient, event: AccountExportEvent) {
  const { data: row } = await supabase
    .from("account_exports")
    .select("id, org_id, requested_by, status")
    .eq("id", event.exportId)
    .maybeSingle();

  if (!row) return { ok: false as const, code: "not_found" };
  // A retry of a finished export must not rebuild it: the archive is already
  // out there and a second one would reset its expiry.
  if (row.status !== "pending") return { ok: false as const, code: "invalid_state", status: row.status };

  await supabase.from("account_exports").update({ status: "running" }).eq("id", row.id);

  try {
    const archive = await buildAccountArchive(supabase, row.org_id as string, {
      scopeNote: event.scopeNote,
      readmeTitle: event.readmeTitle,
    });
    const path = `${row.org_id}/${row.id}.zip`;

    const upload = await supabase.storage.from(BUCKET).upload(path, archive.bytes, {
      contentType: "application/zip",
      upsert: true,
    });
    if (upload.error) throw new Error(upload.error.message);

    const hours = await expiryHours(supabase);
    await supabase
      .from("account_exports")
      .update({
        status: "ready",
        file_path: path,
        size_bytes: archive.bytes.byteLength,
        patient_count: archive.patientCount,
        completed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + hours * 3600_000).toISOString(),
        error: null,
      })
      .eq("id", row.id);

    // She asked minutes ago and moved on; the bell is what brings her back.
    if (row.requested_by) {
      await notifyUsers([row.requested_by as string], {
        type: "system",
        title: event.readyTitle,
        body: event.readyBody,
        href: "/settings/organization",
      });
    }

    return { ok: true as const, patients: archive.patientCount, bytes: archive.bytes.byteLength };
  } catch (cause) {
    // The reason is stored for support, never shown raw: it can carry database
    // text, and this row is readable by the professional.
    await supabase
      .from("account_exports")
      .update({
        status: "failed",
        error: cause instanceof Error ? cause.message : "unknown",
        completed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return { ok: false as const, code: "failed" };
  }
}

export async function purgeExpiredAccountExports(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("purge_expired_account_exports");
  if (error) return { ok: false as const, error: error.message };

  const payload = (data ?? {}) as { ok?: boolean; expired?: number; paths?: string[] };
  if (payload.ok !== true) return { ok: false as const, error: "purge_refused" };

  const paths = (payload.paths ?? []).filter((path) => typeof path === "string" && path !== "");
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
    if (storageError) return { ok: true as const, expired: payload.expired ?? 0, storageError: storageError.message };
  }
  return { ok: true as const, expired: payload.expired ?? 0, removed: paths.length };
}

export const accountExportFunction = inngest.createFunction(
  { id: "account-export-build", retries: 1, concurrency: { limit: 2 } },
  { event: "medchina/account.export" },
  async ({ event, step }) =>
    step.run("build-account-export", async () => runAccountExport(createServiceClient(), event.data)),
);

export const accountExportPurgeFunction = inngest.createFunction(
  { id: "account-export-purge", retries: 1, concurrency: { limit: 1 } },
  { cron: PURGE_CRON },
  async ({ step }) => step.run("purge-account-exports", async () => purgeExpiredAccountExports(createServiceClient())),
);

export const accountExportFunctions = [accountExportFunction, accountExportPurgeFunction];

/** File name offered at download time; the stored object keeps its uuid path. */
export { accountArchiveName };
