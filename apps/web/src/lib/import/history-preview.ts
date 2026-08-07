import { type DateOrder, parseDateValue } from "./dates";
import type { ColumnMapping, ExistingPatient, ImportPreview, ParsedTable, RowIssue, StagedRow } from "./types";

import { normalizePatientName } from "@/lib/patients";

/**
 * The dry-run for a HISTORY import: one line per past consultation.
 *
 * The text is carried whole and never parsed into anamnesis fields — a record
 * written in another system has no per-field provenance, so it is read as
 * prose (docs/IMPORT-EXPORT.md §0). What this pass actually decides is WHO the
 * line belongs to, and it is deliberately strict about it: filing a record in
 * the wrong chart is the worst thing an import can do here, and unlike a
 * duplicate it is invisible afterwards.
 *
 * So a patient is resolved by the old system's id first (exact, safe) and by
 * name only when EXACTLY ONE active patient matches. Two homonyms, or none,
 * and the line is refused with its reason instead of guessed at.
 */

export type HistoryPreviewInput = {
  table: ParsedTable;
  mapping: ColumnMapping;
  /** Confirmed order for the date column. Undefined means unresolved. */
  dateOrder?: DateOrder;
  existing: ExistingPatient[];
};

const HEADER_ROW_OFFSET = 2;

export function buildHistoryPreview({ table, mapping, dateOrder, existing }: HistoryPreviewInput): ImportPreview {
  const byExternalRef = new Map<string, string>();
  const byName = new Map<string, string[]>();

  for (const patient of existing) {
    if (patient.externalRef) byExternalRef.set(patient.externalRef, patient.id);
    const key = normalizePatientName(patient.fullName);
    if (key) byName.set(key, [...(byName.get(key) ?? []), patient.id]);
  }

  const columnWarnings: RowIssue[] = [];
  if (mapping.date !== undefined && !dateOrder) {
    columnWarnings.push({ code: "date_order_unresolved", field: "date", header: table.headers[mapping.date] });
  }

  const seenExternalRef = new Map<string, number>();
  const rows: StagedRow[] = table.rows.map((row, index) => {
    const rowNumber = index + HEADER_ROW_OFFSET;
    const cell = (position?: number) => (position === undefined ? "" : (row[position] ?? "").trim());

    const raw: Record<string, string> = {};
    row.forEach((value, position) => {
      const header = table.headers[position]?.trim();
      raw[header && header !== "" ? header : `coluna_${position + 1}`] = value;
    });

    const staged: StagedRow = {
      rowNumber,
      raw,
      normalized: {},
      action: "create",
      targetType: "consultation",
      warnings: [],
    };
    const refuse = (code: string): StagedRow => ({ ...staged, action: "error", errorCode: code, normalized: {} });

    const body = cell(mapping.body);
    if (body === "") return refuse("legacy_body_required");

    const dateRaw = cell(mapping.date);
    if (dateRaw === "") return refuse("record_date_required");
    if (!dateOrder) return refuse("date_order_unresolved");
    const date = parseDateValue(dateRaw, dateOrder);
    // Never file an unreadable date as today: the record would land in the
    // wrong place on the timeline and nothing would flag it.
    if (!date) return refuse("date_not_recognized");

    const patientRef = cell(mapping.patient_ref);
    const patientName = cell(mapping.patient_name);
    let patientId = patientRef ? byExternalRef.get(patientRef) : undefined;

    if (!patientId && patientName) {
      const matches = byName.get(normalizePatientName(patientName)) ?? [];
      if (matches.length > 1) return refuse("patient_ambiguous");
      patientId = matches[0];
    }
    if (!patientId) return refuse("patient_not_found");

    const externalRef = cell(mapping.external_ref);
    if (externalRef && seenExternalRef.has(externalRef)) {
      return { ...staged, action: "skip", errorCode: "duplicate_in_file", normalized: {} };
    }
    if (externalRef) seenExternalRef.set(externalRef, rowNumber);

    const source = cell(mapping.source);
    // `target_id` is left for the commit to fill with the consultation it
    // creates; WHO the record belongs to travels in `normalized.patient_id`,
    // which is what the writer reads and re-checks against the workspace.
    return {
      ...staged,
      normalized: {
        patient_id: patientId,
        date,
        body,
        ...(externalRef ? { external_ref: externalRef } : {}),
        ...(source ? { source } : {}),
      },
    };
  });

  const summary = { create: 0, update: 0, skip: 0, error: 0 };
  for (const row of rows) summary[row.action] += 1;

  return { rows, summary, columnWarnings };
}
