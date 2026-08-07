import { type DateOrder, isImplausibleBirthDate, parseDateValue } from "./dates";
import {
  normalizeDocument,
  normalizeEmail,
  normalizeExternalRef,
  normalizeFullName,
  normalizeNotes,
  normalizePhone,
} from "./normalize";
import type {
  ColumnMapping,
  ExistingPatient,
  ImportPreview,
  ParsedTable,
  PatientFieldKey,
  RowIssue,
  StagedRow,
} from "./types";

import { normalizePatientName } from "@/lib/patients";
import { onlyDigits } from "@flyee/fields";

/**
 * Parsed table + confirmed mapping -> exactly what the commit will write.
 *
 * This is the dry-run. Whatever it decides here is staged and committed
 * verbatim: the preview and the write must never re-derive anything
 * separately, or she approves one outcome and gets another.
 *
 * Matching rules, in the order they are tried:
 *   1. `external_ref` — the old system's own id. Authoritative: update.
 *   2. document — the same CPF is the same person. Update.
 *   3. name + birth date — NOT enough to merge two charts automatically.
 *      Homonyms with the same birth date exist, and merging the wrong two
 *      patients is unrecoverable, so the row is held for her decision.
 */

export type PreviewInput = {
  table: ParsedTable;
  mapping: ColumnMapping;
  surnameColumn?: number;
  /** Confirmed order for the birth-date column. Undefined means unresolved. */
  dateOrder?: DateOrder;
  existing: ExistingPatient[];
};

const HEADER_ROW_OFFSET = 2;

function documentKey(value: string): string {
  const digits = onlyDigits(value);
  return digits.length >= 11 ? digits : value.trim().toLowerCase();
}

export function buildImportPreview({
  table,
  mapping,
  surnameColumn,
  dateOrder,
  existing,
}: PreviewInput): ImportPreview {
  const byExternalRef = new Map<string, string>();
  const byDocument = new Map<string, string>();
  const byNameBirth = new Map<string, string>();

  for (const patient of existing) {
    if (patient.externalRef) byExternalRef.set(patient.externalRef, patient.id);
    if (patient.document) byDocument.set(documentKey(patient.document), patient.id);
    if (patient.birthDate) {
      byNameBirth.set(`${normalizePatientName(patient.fullName)}|${patient.birthDate}`, patient.id);
    }
  }

  const seenExternalRef = new Map<string, number>();
  const seenDocument = new Map<string, number>();
  const columnWarnings: RowIssue[] = [];
  const rows: StagedRow[] = [];

  const birthHeader = mapping.birth_date === undefined ? undefined : table.headers[mapping.birth_date];
  if (mapping.birth_date !== undefined && !dateOrder) {
    columnWarnings.push({ code: "date_order_unresolved", field: "birth_date", header: birthHeader });
  }

  table.rows.forEach((row, index) => {
    const rowNumber = index + HEADER_ROW_OFFSET;
    const cell = (position?: number) => (position === undefined ? "" : (row[position] ?? ""));

    const raw: Record<string, string> = {};
    row.forEach((value, position) => {
      const header = table.headers[position]?.trim();
      raw[header && header !== "" ? header : `coluna_${position + 1}`] = value;
    });

    const normalized: Partial<Record<PatientFieldKey, string>> = {};
    const warnings: RowIssue[] = [];

    // The mapped name column is the identity of the record. A surname alone
    // does not rescue a row whose name cell is empty: "da Silva" is not a
    // patient, and importing it would create a chart nobody can find again.
    const primaryName = normalizeFullName(cell(mapping.full_name));
    const surname = surnameColumn === undefined ? "" : normalizeFullName(cell(surnameColumn));
    const fullName = [primaryName, surname].filter((piece) => piece !== "").join(" ");

    if (primaryName === "") {
      rows.push({
        rowNumber,
        raw,
        normalized: {},
        action: "error",
        errorCode: "full_name_required",
        warnings,
      });
      return;
    }
    normalized.full_name = fullName;

    const birthRaw = cell(mapping.birth_date).trim();
    if (birthRaw !== "") {
      if (!dateOrder) {
        // Never guess: an unresolved column means the value waits for her
        // answer instead of entering the chart under a coin flip.
        warnings.push({ code: "birth_date_unresolved", field: "birth_date" });
      } else {
        const iso = parseDateValue(birthRaw, dateOrder);
        if (!iso) {
          warnings.push({ code: "date_not_recognized", field: "birth_date" });
        } else {
          normalized.birth_date = iso;
          if (isImplausibleBirthDate(iso)) {
            warnings.push({ code: "birth_date_implausible", field: "birth_date" });
          }
        }
      }
    }

    const document = normalizeDocument(cell(mapping.document));
    if (document.value) normalized.document = document.value;
    if (document.warning) warnings.push(document.warning);

    const phone = normalizePhone(cell(mapping.phone));
    if (phone.value) normalized.phone = phone.value;
    if (phone.warning) warnings.push(phone.warning);

    const email = normalizeEmail(cell(mapping.email));
    if (email.value) normalized.email = email.value;
    if (email.warning) warnings.push(email.warning);

    const notes = normalizeNotes(cell(mapping.notes));
    if (notes) normalized.notes = notes;

    const externalRef = normalizeExternalRef(cell(mapping.external_ref));
    if (externalRef) normalized.external_ref = externalRef;

    const staged: StagedRow = { rowNumber, raw, normalized, action: "create", warnings };

    const duplicateOf =
      (externalRef && seenExternalRef.get(externalRef)) ||
      (normalized.document && seenDocument.get(documentKey(normalized.document)));

    if (duplicateOf) {
      staged.action = "skip";
      staged.errorCode = "duplicate_in_file";
      rows.push(staged);
      return;
    }

    if (externalRef) seenExternalRef.set(externalRef, rowNumber);
    if (normalized.document) seenDocument.set(documentKey(normalized.document), rowNumber);

    const matchedByRef = externalRef ? byExternalRef.get(externalRef) : undefined;
    const matchedByDocument = normalized.document ? byDocument.get(documentKey(normalized.document)) : undefined;
    const matchedByPerson = normalized.birth_date
      ? byNameBirth.get(`${normalizePatientName(fullName)}|${normalized.birth_date}`)
      : undefined;

    if (matchedByRef || matchedByDocument) {
      staged.action = "update";
      staged.targetType = "patient";
      staged.targetId = matchedByRef ?? matchedByDocument ?? null;
    } else if (matchedByPerson) {
      staged.action = "skip";
      staged.errorCode = "possible_duplicate";
      staged.targetType = "patient";
      staged.targetId = matchedByPerson;
    }

    rows.push(staged);
  });

  const summary = { create: 0, update: 0, skip: 0, error: 0 };
  for (const row of rows) summary[row.action] += 1;

  return { rows, summary, columnWarnings };
}
