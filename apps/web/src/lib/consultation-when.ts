/**
 * WHEN a consultation happened — one answer, used by everything that reads the
 * patient's history.
 *
 * There are three candidate columns and they disagree by design. `started_at`
 * is when the appointment actually took place. `created_at` is when the ROW was
 * written, which for an imported history is the moment of the import — the same
 * instant for the whole batch, years after the visits themselves.
 *
 * Ordering by `created_at` while DISPLAYING `started_at` is what made the
 * continuity layer point at an arbitrary row of the import batch and label it
 * with a real date from a different visit. Every reader now orders and dates by
 * the same value.
 */
export function consultationWhen(row: {
  startedAt?: string | null;
  scheduledFor?: string | null;
  createdAt?: string | null;
}): string | null {
  return row.startedAt ?? row.scheduledFor ?? row.createdAt ?? null;
}

/**
 * The PostgREST ordering that matches `consultationWhen`, newest first.
 *
 * `nullsFirst: false` is load-bearing: in a descending order Postgres puts
 * NULLs first by default, so a consultation with no `started_at` would outrank
 * every real visit. The `created_at` tiebreak keeps rows from one import batch
 * in a stable order.
 */
export const CONSULTATION_ORDER = [
  { column: "started_at", ascending: false, nullsFirst: false },
  { column: "created_at", ascending: false },
] as const;

/**
 * A record migrated from another system is kept whole in `legacy_body` and is
 * deliberately never parsed into anamnesis fields, so those consultations have
 * no answers at all. Truncated per consultation before it reaches a prompt: a
 * single long import would otherwise eat the whole context budget.
 */
export function legacyExcerpt(body: string | null | undefined, limit: number): string | null {
  const text = (body ?? "").trim();
  if (!text) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}…`;
}
