import "server-only";

import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Retention for imports (docs/IMPORT-EXPORT.md §3).
 *
 * A migration spreadsheet is a practice's patient list in plain text, and the
 * staged rows are the same data parsed. Both are kept for ONE purpose — being
 * able to undo the import — so once that window closes they go. The batch
 * itself stays: it is the provenance of every record it created.
 *
 * The database cannot delete a storage object, so `purge_import_staging`
 * clears the rows and hands back the paths for this job to remove. A file that
 * fails to delete is reported, never retried into a loop: the row data is
 * already gone and the batch is marked purged.
 */

/** 03:20 UTC — outside the practice day in the launch market. */
const CRON = "20 3 * * *";
const BUCKET = "imports";

export async function purgeImportStaging(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("purge_import_staging");
  if (error) return { ok: false as const, error: error.message };

  const payload = (data ?? {}) as { ok?: boolean; batches?: number; paths?: string[] };
  if (payload.ok !== true) return { ok: false as const, error: "purge_refused" };

  const paths = (payload.paths ?? []).filter((path) => typeof path === "string" && path !== "");
  let removed = 0;
  if (paths.length > 0) {
    const { data: deleted, error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
    if (storageError) {
      return { ok: true as const, batches: payload.batches ?? 0, removed: 0, storageError: storageError.message };
    }
    removed = deleted?.length ?? 0;
  }

  return { ok: true as const, batches: payload.batches ?? 0, removed };
}

export const purgeImportStagingFunction = inngest.createFunction(
  { id: "import-purge-staging", retries: 1, concurrency: { limit: 1 } },
  { cron: CRON },
  async ({ step }) =>
    step.run("purge-import-staging", async () => {
      // Service role: the RPC refuses every other caller, because deciding
      // that personal data may be dropped is not a session-level action.
      return purgeImportStaging(createServiceClient());
    }),
);

export const importFunctions = [purgeImportStagingFunction];
