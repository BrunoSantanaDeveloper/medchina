import { consultationWhen, legacyExcerpt } from "@/lib/consultation-when";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the last finalized consultation recorded, field by field (PRD §8.3
 * "mudanças desde a consulta anterior").
 *
 * Most consultations in a TCM practice are RETURNS, and today a return starts
 * from an empty chart: to recall what she wrote about sleep, energy or pulse
 * the professional opens the previous consultation in another tab and copies
 * by hand. The data was already there — `anamnesis_answers` keys are stable
 * (lib/anamnesis.ts), so the previous value for the same field is a lookup,
 * not an inference.
 *
 * Deliberately deterministic: no AI call, no consent gate, no minutes, every
 * plan. It is also what makes the comparison trustworthy — it reports what she
 * herself validated last time, never a model's reading of it.
 */

export type PreviousAnswer = {
  /** "block.field" — the same composite key the consultation page uses. */
  key: string;
  value: string;
  /** Whether the previous value came from the professional or the AI draft. */
  source: string;
};

/** One consultation imported from another system, as its original text. */
export type ImportedRecord = {
  id: string;
  when: string;
  excerpt: string;
  source: string | null;
};

export interface PreviousConsultation {
  id: string;
  /** When it happened (finalized consultations always have one of these). */
  when: string;
  chiefComplaint: string | null;
  summary: string | null;
  /**
   * A consultation imported from another system keeps its whole text here and
   * has NO anamnesis answers, so the field-by-field comparison below has
   * nothing to compare. Showing the original text is the honest fallback.
   */
  legacyBody: string | null;
  /**
   * When the last consultation was imported, the most recent imported records
   * (newest first, the last one included). An import often lands several
   * visits on the same day, so "the" previous consultation alone would be an
   * arbitrary pick among them. Empty when the last consultation was written here.
   */
  importedHistory: ImportedRecord[];
  answers: Record<string, PreviousAnswer>;
  /** Patterns she accepted or rewrote — her reading, not the model's draft. */
  patterns: string[];
  /** Questions the AI flagged as unanswered last time (PRD §10.2 gaps). */
  gaps: string[];
}

export type PreviousConsultationResult = { ok: true; data: PreviousConsultation | null } | { ok: false; error: string };

/**
 * Loads the most recent FINALIZED consultation of this patient, excluding the
 * one being written now. Runs under the caller's RLS.
 */
export async function loadPreviousConsultation(
  supabase: SupabaseClient,
  input: { patientId: string; excludeConsultationId: string },
): Promise<PreviousConsultationResult> {
  const { data: recent, error } = await supabase
    .from("consultations")
    .select("id, started_at, scheduled_for, created_at, chief_complaint, summary, ai_gaps, legacy_body, legacy_source")
    .eq("patient_id", input.patientId)
    .eq("status", "finalized")
    .neq("id", input.excludeConsultationId)
    // By when the visit HAPPENED. Ordering by created_at while displaying
    // started_at made "a consulta anterior" point at an arbitrary row of an
    // import batch and label it with another visit's real date.
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(IMPORTED_HISTORY_LIMIT);
  if (error) return { ok: false, error: error.message };
  const rows = (recent ?? []) as HistoryRow[];
  const previous = rows[0];
  if (!previous) return { ok: true, data: null };

  const [answersResult, hypothesesResult] = await Promise.all([
    supabase.from("anamnesis_answers").select("block_key, field_key, value, source").eq("consultation_id", previous.id),
    supabase
      .from("consultation_hypotheses")
      .select("pattern, status")
      .eq("consultation_id", previous.id)
      .in("status", ["accepted", "edited"]),
  ]);
  if (answersResult.error) return { ok: false, error: answersResult.error.message };

  const answers: Record<string, PreviousAnswer> = {};
  for (const row of answersResult.data ?? []) {
    const key = `${row.block_key as string}.${row.field_key as string}`;
    answers[key] = {
      key,
      value: (row.value as string) ?? "",
      source: (row.source as string) ?? "professional",
    };
  }

  return {
    ok: true,
    data: {
      id: previous.id as string,
      when: consultationWhen({
        startedAt: previous.started_at as string | null,
        scheduledFor: previous.scheduled_for as string | null,
        createdAt: previous.created_at as string | null,
      }) as string,
      chiefComplaint: (previous.chief_complaint as string | null) ?? null,
      summary: (previous.summary as string | null) ?? null,
      legacyBody: legacyExcerpt(previous.legacy_body as string | null, 400),
      importedHistory: pickImportedHistory(rows, Object.keys(answers).length > 0),
      answers,
      patterns: (hypothesesResult.data ?? []).map((row) => row.pattern as string),
      gaps: Array.isArray(previous.ai_gaps) ? (previous.ai_gaps as string[]) : [],
    },
  };
}

/** How many imported records the return shows beside the chart. */
export const IMPORTED_HISTORY_LIMIT = 3;
const IMPORTED_EXCERPT_CHARS = 280;

export type HistoryRow = {
  id: string;
  started_at: string | null;
  scheduled_for: string | null;
  created_at: string | null;
  legacy_body: string | null;
  legacy_source: string | null;
  [column: string]: unknown;
};

/**
 * The imported records to show when the last consultation came from another
 * system: the unbroken run of imported rows at the top of the history, newest
 * first. Stops at the first consultation written here, and returns nothing when
 * the last consultation has answers — then the field-by-field comparison is
 * the better view and the import is old context.
 */
export function pickImportedHistory(rows: HistoryRow[], previousHasAnswers: boolean): ImportedRecord[] {
  if (previousHasAnswers) return [];
  const records: ImportedRecord[] = [];
  for (const row of rows.slice(0, IMPORTED_HISTORY_LIMIT)) {
    const excerpt = legacyExcerpt(row.legacy_body, IMPORTED_EXCERPT_CHARS);
    if (!excerpt) break;
    records.push({
      id: row.id,
      when: consultationWhen({
        startedAt: row.started_at,
        scheduledFor: row.scheduled_for,
        createdAt: row.created_at,
      }) as string,
      excerpt,
      source: row.legacy_source ?? null,
    });
  }
  return records;
}

export type FieldChange = "new" | "changed" | "same" | "missing";

/**
 * How this consultation's answer compares with the previous one.
 *
 * "missing" (recorded before, blank now) is a FIRST-CLASS outcome and never a
 * negative: an unfilled field means "não informado" (PRD §10.5), so it is
 * surfaced as something still to ask, not as something that stopped being true.
 */
export function compareAnswer(current: string | undefined, previous: string | undefined): FieldChange {
  const now = (current ?? "").trim();
  const before = (previous ?? "").trim();
  if (!before && now) return "new";
  if (before && !now) return "missing";
  if (!before && !now) return "same";
  return now === before ? "same" : "changed";
}

export type ChangeSummary = { changed: number; new: number; missing: number };

/** Counts, for the "what changed since the last consultation" headline. */
export function summarizeChanges(
  currentValues: Record<string, string | undefined>,
  previous: PreviousConsultation | null,
  fieldKeys: string[],
): ChangeSummary {
  const summary: ChangeSummary = { changed: 0, new: 0, missing: 0 };
  if (!previous) return summary;
  for (const key of fieldKeys) {
    const change = compareAnswer(currentValues[key], previous.answers[key]?.value);
    if (change === "changed") summary.changed += 1;
    else if (change === "new") summary.new += 1;
    else if (change === "missing") summary.missing += 1;
  }
  return summary;
}
