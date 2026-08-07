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

/** Field -> column index in the parsed table. A column serves one field. */
export type ColumnMapping = Partial<Record<PatientFieldKey, number>>;

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
  field?: PatientFieldKey;
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
  normalized: Partial<Record<PatientFieldKey, string>>;
  action: RowAction;
  targetType?: "patient";
  targetId?: string | null;
  errorCode?: string;
  warnings: RowIssue[];
};

export type ImportPreview = {
  rows: StagedRow[];
  summary: { create: number; update: number; skip: number; error: number };
  /** Problems with a whole column (an unresolved date order, say). */
  columnWarnings: RowIssue[];
};

/** A patient already in the workspace, for duplicate resolution. */
export type ExistingPatient = {
  id: string;
  externalRef: string | null;
  document: string | null;
  fullName: string;
  birthDate: string | null;
};
