/**
 * The chief complaint can now span several lines (the professional writes the
 * whole story there), but most places that USE it were built for one line:
 *
 * - prompts list one fact per line ("Queixa principal: ...", "- key: value"),
 *   and a multi-line value dissolves that structure;
 * - the first retrieval query of the library search starts with it, and five
 *   lines of narrative dilute the embedding until points and formulas stop
 *   coming back — no error, just worse answers;
 * - inline listings (briefing, agenda) put it after a dash.
 *
 * The first line is the case's TITLE — the AI extraction writes exactly one
 * short line there, and she expands below it.
 */

/** The whole complaint on one line, for a prompt that lists one fact per line. */
export function complaintOnOneLine(value: string | null | undefined): string {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ");
}

/** The first non-empty line, capped — the title of the case. */
export function complaintTitle(value: string | null | undefined, maxLength = 200): string {
  const first =
    (value ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  return first.length <= maxLength ? first : `${first.slice(0, maxLength).trimEnd()}…`;
}
