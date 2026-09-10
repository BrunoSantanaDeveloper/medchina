/**
 * Shared vocabulary for the spreadsheet import (docs/IMPORT-EXPORT.md, Fase B).
 *
 * The engine is deliberately pure: bytes in, staged rows out. Nothing here
 * touches the database, so every rule that decides what a cell MEANS can be
 * asserted in a unit test instead of being discovered on a real practice's
 * data.
 */

export type ImportKind = "patients" | "history" | "schedule";

/** Columns of `patients` an import may fill. Order drives mapping priority. */
export const PATIENT_FIELDS = [
  "full_name",
  "birth_date",
  "document",
  "phone",
  "email",
  "external_ref",
  "notes",
] as const;

export type PatientFieldKey = (typeof PATIENT_FIELDS)[number];

/**
 * Columns of a HISTORY spreadsheet: one line per past consultation. The text
 * lands whole in `legacy_body` and is never split into anamnesis fields — a
 * record written elsewhere has no per-field provenance (docs/IMPORT-EXPORT.md
 * §0), so it is read as prose, not asserted as clinical data.
 *
 * The patient is identified by the old system's id when it exists and by name
 * otherwise; both are mapped because real exports carry one or the other.
 */
export const HISTORY_FIELDS = ["patient_ref", "patient_name", "date", "body", "external_ref", "source"] as const;

export type HistoryFieldKey = (typeof HISTORY_FIELDS)[number];

/**
 * Columns of an AGENDA spreadsheet: one line per appointment already booked.
 * The time is its own field because exports split it from the date as often as
 * they glue it on, and the wall clock is what she actually agreed with the
 * patient.
 */
export const SCHEDULE_FIELDS = [
  "patient_ref",
  "patient_name",
  "date",
  "time",
  "duration",
  "note",
  "external_ref",
] as const;

export type ScheduleFieldKey = (typeof SCHEDULE_FIELDS)[number];

export type ImportFieldKey = PatientFieldKey | HistoryFieldKey | ScheduleFieldKey;

/** Field -> column index in the parsed table. A column serves one field. */
export type ColumnMapping = Partial<Record<ImportFieldKey, number>>;

/**
 * What the commit writes. Keys are the DB's vocabulary, not the spreadsheet's:
 * a history row resolves its patient to `patient_id` here, so the writer never
 * has to guess who a line belongs to.
 */
export type NormalizedRow = Partial<Record<ImportFieldKey, string>> & {
  patient_id?: string;
  /** Agenda: the wall clock as the practice reads it, converted by the writer. */
  local_datetime?: string;
};

export type SpreadsheetEncoding = "utf-8" | "windows-1252";

export type ParsedTable = {
  headers: string[];
  rows: string[][];
  delimiter: string;
  encoding: SpreadsheetEncoding;
};

export type RowAction = "create" | "update" | "skip" | "error";

export type RowIssue = {
  code: string;
  field?: ImportFieldKey;
  /** Column header when the issue is about the column as a whole. */
  header?: string;
};

export type StagedRow = {
  /**
   * The line number SHE sees in the spreadsheet: the header is line 1, so the
   * first data row is line 2. Off-by-one here means every error message points
   * at the wrong row.
   */
  rowNumber: number;
  raw: Record<string, string>;
  /**
   * Only fields that actually carry a value. A missing key is "não informado"
   * — an empty string would be a stored answer (PRD §10.5).
   */
  normalized: NormalizedRow;
  action: RowAction;
  targetType?: "patient" | "consultation";
  targetId?: string | null;
  errorCode?: string;
  warnings: RowIssue[];
};

export type ImportPreview = {
  rows: StagedRow[];
  summary: { create: number; update: number; skip: number; error: number };
  /** Problems with a whole column (an unresolved date order, say). */
  columnWarnings: RowIssue[];
  /** Patients only — the other kinds have no notion of a repeated identity. */
  repeatedNames?: RepeatedNamesVerdict;
};

/**
 * Whether a sheet looks like ONE LINE PER VISIT instead of one line per
 * patient. It is the only signal that does not depend on how the columns are
 * NAMED, which is why it is the one the wizard stops on: an attendance export
 * whose headers happen to look like a patient sheet still repeats the same
 * person on every line.
 */
export type RepeatedNamesVerdict = {
  /** Rows whose name already appeared on an earlier row of the same file. */
  repeated: number;
  /** Rows that would CREATE a chart and carry a usable name. */
  considered: number;
  /** The largest number of rows sharing one name. */
  maxPerName: number;
  /** True when the file should not be imported as a patient registry. */
  suspicious: boolean;
  /** Up to three names, to show her instead of asserting it. */
  examples: string[];
};

/** A patient already in the workspace, for duplicate resolution. */
export type ExistingPatient = {
  id: string;
  externalRef: string | null;
  document: string | null;
  fullName: string;
  birthDate: string | null;
  /** Still matched against — only left out of "how many she has today". */
  archived?: boolean;
};
