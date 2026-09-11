/**
 * Cells that SAY nothing: "NULL", "N/A", "--", "não informado" and the handful
 * of others an old system (or its export) writes where a value is simply absent.
 *
 * They must never enter a chart. A patient whose "Observações" read NULL is the
 * visible damage, but the quiet one is worse: an empty cell never clears a field
 * and never merges two charts, while a placeholder is a VALUE — "NULL" in the
 * old system's id column is unique per workspace, so the first line takes it and
 * every other patient carrying it is skipped as a duplicate. Read as empty, they
 * go back to being "não informado" (PRD §10.5).
 *
 * The list is short, exact and matched WHOLE. A cell is a placeholder or it is
 * content — "nenhuma" in an allergies column is an answer, and substring
 * matching would swallow "N/A de rotina". Words that are also ordinary values
 * stay out on purpose ("na", "nd", "x", "0").
 */

const PLACEHOLDER_CELLS = new Set([
  "null",
  "(null)",
  "nulo",
  "nula",
  "nil",
  "none",
  "nan",
  "undefined",
  "n/a",
  "n.a.",
  "n/d",
  "#n/a",
  "#n/d",
  "#valor!",
  "#value!",
  "#ref!",
  "#div/0!",
  "#nome?",
  "#name?",
  "#null!",
  "vazio",
  "em branco",
  "sem informacao",
  "sem informacoes",
  "sem dados",
  "sem registro",
  "nao informado",
  "nao informada",
  "nao informou",
  "nao consta",
]);

/** Only punctuation: "-", "--", "...", "?", "—". */
const PUNCTUATION_ONLY = /^[-–—_.?]+$/;

function fold(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Whether this cell is a written-down absence. An empty cell is not one. */
export function isPlaceholderCell(raw: string): boolean {
  const token = fold(raw);
  if (token === "") return false;
  return PUNCTUATION_ONLY.test(token) || PLACEHOLDER_CELLS.has(token);
}

/** Every cell the import reads goes through here: trimmed, absence as absence. */
export function readCell(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  return isPlaceholderCell(value) ? "" : value;
}
