import type { ImportKind, StagedRow } from "./types";

import { recordAudit } from "@/lib/audit";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The database side of an import: create the batch, stage what the preview
 * decided, commit it, undo it.
 *
 * Everything that DECIDES anything lives in the pure modules; this file only
 * carries those decisions across the wire. The commit itself is a single RPC
 * because a half-written import is worse than a refused one — see
 * 0077_import_commit.sql.
 */

export type ImportFailure = { ok: false; error: string; code?: string; details?: Record<string, unknown> };
export type ImportResult<T> = { ok: true; data: T } | ImportFailure;

export type ImportCounts = { created: number; updated: number; skipped: number; failed: number };

export type ImportAllowance = {
  allowed: boolean;
  unlimited: boolean;
  maxRows: number | null;
  reason: string;
};

/** Batches of staged rows per request: large enough to be few, small enough
 * that a failure retries cheaply. */
const STAGE_CHUNK = 500;

export async function fetchImportAllowance(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ImportResult<ImportAllowance>> {
  const { data, error } = await supabase.rpc("org_import_allowance", { target_org: orgId });
  if (error) return { ok: false, error: error.message };
  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      allowed: payload.allowed === true,
      unlimited: payload.unlimited === true,
      maxRows: typeof payload.maxRows === "number" ? payload.maxRows : null,
      reason: typeof payload.reason === "string" ? payload.reason : "ok",
    },
  };
}

export async function createImportBatch(
  supabase: SupabaseClient,
  input: { orgId: string; kind: ImportKind; sourceSystem?: string; fileName?: string },
): Promise<ImportResult<string>> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("import_batches")
    .insert({
      org_id: input.orgId,
      kind: input.kind,
      source_system: input.sourceSystem?.trim() || null,
      file_name: input.fileName ?? null,
      created_by: userData.user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data.id as string };
}

export async function attachImportFile(
  supabase: SupabaseClient,
  input: { batchId: string; filePath: string; checksum?: string },
): Promise<ImportResult<true>> {
  const { error } = await supabase
    .from("import_batches")
    .update({ file_path: input.filePath, file_checksum: input.checksum ?? null })
    .eq("id", input.batchId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: true };
}

/**
 * Replaces the staged rows of a batch. Replacing (not appending) is what makes
 * re-mapping the columns safe: the second preview must not leave the first
 * one's rows behind.
 */
export async function stageImportRows(
  supabase: SupabaseClient,
  input: { batchId: string; orgId: string; rows: StagedRow[]; mapping: Record<string, unknown> },
): Promise<ImportResult<number>> {
  const cleared = await supabase.from("import_rows").delete().eq("batch_id", input.batchId);
  if (cleared.error) return { ok: false, error: cleared.error.message };

  for (let start = 0; start < input.rows.length; start += STAGE_CHUNK) {
    const chunk = input.rows.slice(start, start + STAGE_CHUNK).map((row) => ({
      batch_id: input.batchId,
      org_id: input.orgId,
      row_number: row.rowNumber,
      raw: row.raw,
      normalized: row.normalized,
      warnings: row.warnings,
      action: row.action,
      target_type: row.targetType ?? null,
      target_id: row.targetId ?? null,
      // Messages are rendered from the code, in her language — an English
      // string stored here would leak into the UI the day someone displays it.
      error_code: row.errorCode ?? null,
    }));

    const { error } = await supabase.from("import_rows").insert(chunk);
    if (error) return { ok: false, error: error.message };
  }

  const { error } = await supabase
    .from("import_batches")
    .update({ status: "preview", mapping: input.mapping })
    .eq("id", input.batchId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, data: input.rows.length };
}

function rpcFailure(payload: Record<string, unknown>): ImportFailure {
  const code = typeof payload.code === "string" ? payload.code : "unknown_error";
  return { ok: false, error: code, code };
}

export async function commitImportBatch(
  supabase: SupabaseClient,
  input: { batchId: string; orgId: string },
): Promise<ImportResult<ImportCounts>> {
  const { data, error } = await supabase.rpc("commit_import_batch", { target_batch: input.batchId });
  if (error) return { ok: false, error: error.message };

  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.ok !== true) return rpcFailure(payload);

  const counts: ImportCounts = {
    created: Number(payload.created ?? 0),
    updated: Number(payload.updated ?? 0),
    skipped: Number(payload.skipped ?? 0),
    failed: Number(payload.failed ?? 0),
  };

  await recordAudit(supabase, "import.committed", {
    orgId: input.orgId,
    entityType: "import_batch",
    entityId: input.batchId,
    metadata: counts,
  });

  return { ok: true, data: counts };
}

export async function revertImportBatch(
  supabase: SupabaseClient,
  input: { batchId: string; orgId: string },
): Promise<ImportResult<{ patients: number; consultations: number; blocked?: Record<string, number> }>> {
  const { data, error } = await supabase.rpc("revert_import_batch", { target_batch: input.batchId });
  if (error) return { ok: false, error: error.message };

  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.ok !== true) {
    // The refusal carries WHY, and the screen needs it to say more than "não
    // foi possível" — pass the blockers through instead of flattening them.
    const blocked = payload.blocked as Record<string, unknown> | undefined;
    return { ...rpcFailure(payload), details: blocked };
  }

  await recordAudit(supabase, "import.reverted", {
    orgId: input.orgId,
    entityType: "import_batch",
    entityId: input.batchId,
    metadata: { patients: Number(payload.patients ?? 0), consultations: Number(payload.consultations ?? 0) },
  });

  return {
    ok: true,
    data: {
      patients: Number(payload.patients ?? 0),
      consultations: Number(payload.consultations ?? 0),
    },
  };
}
