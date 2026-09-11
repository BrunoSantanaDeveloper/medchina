import { type DateOrder, isImplausibleBirthDate, parseDateValue } from "./dates";
import {
  normalizeDocument,
  normalizeEmail,
  normalizeExternalRef,
  normalizeFullName,
  normalizeNotes,
  normalizePhone,
} from "./normalize";
import { readCell } from "./placeholders";
import type {
  ColumnMapping,
  ExistingPatient,
  ImportPreview,
  ParsedTable,
  PatientFieldKey,
  RepeatedNamesVerdict,
  RowIssue,
  StagedRow,
} from "./types";

import { normalizePatientName } from "@/lib/patients";
import { isValidCnpj, isValidCpf, onlyDigits } from "@flyee/fields";

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

/**
 * The key a document may MERGE two charts by, or null when it may not.
 *
 * Only a CPF or CNPJ that PASSES its check digit identifies a person. This used
 * to fall back to the lowercased text, which turned any wrongly mapped column
 * into an identity: with "Alergias" read as the document, forty patients
 * answering "Nenhuma" collapsed into one key — thirty-nine skipped in silence
 * and the first written over a stranger's chart. Shape alone was not enough
 * either (found in review): "000.000.000-00", the placeholder old systems type
 * for everyone without a CPF, has eleven digits.
 *
 * A value with a leading zero eaten by Excel is padded back before the check,
 * so it keeps matching the chart an earlier import stored. An RG, a typo'd CPF
 * or a foreign document is still STORED — she reconciles by reading it — but
 * merging two people is unrecoverable, so it never merges anything on its own.
 */
function documentKey(value: string): string | null {
  const digits = onlyDigits(value);
  if (digits.length >= 9 && digits.length <= 11) {
    const cpf = digits.padStart(11, "0");
    return isValidCpf(cpf) ? cpf : null;
  }
  if (digits.length >= 12 && digits.length <= 14) {
    const cnpj = digits.padStart(14, "0");
    return isValidCnpj(cnpj) ? cnpj : null;
  }
  return null;
}

/** Enough digits to be SOME document (a CPF, an RG) rather than a word. */
const looksLikeDocument = (value: string) => onlyDigits(value).length >= 7;

/**
 * The signature of a sheet exported per EVENT rather than per patient.
 *
 * Everything is PROPORTIONAL to the file, because a fixed count is wrong in a
 * real practice: three "Maria Silva" among 2,000 charts is ordinary, and a
 * first draft that fired on "any name three times" told a legitimate registry
 * it looked like an attendance export. Repeats reaching a fifth of the file,
 * or one name holding a tenth of it, are not a patient registry.
 */
export function assessRepeatedNames(rows: StagedRow[]): RepeatedNamesVerdict {
  const counts = new Map<string, { count: number; label: string }>();

  for (const row of rows) {
    if (row.action !== "create") continue;
    const label = row.normalized.full_name ?? "";
    const key = normalizePatientName(label);
    if (key === "") continue;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { count: 1, label });
  }

  let considered = 0;
  let repeated = 0;
  let maxPerName = 0;
  const examples: string[] = [];

  for (const { count, label } of counts.values()) {
    considered += count;
    maxPerName = Math.max(maxPerName, count);
    if (count > 1) {
      repeated += count - 1;
      if (examples.length < 3) examples.push(label);
    }
  }

  return {
    repeated,
    considered,
    maxPerName,
    suspicious:
      repeated >= 2 &&
      (repeated / Math.max(considered, 1) >= 0.2 || (maxPerName >= 3 && maxPerName / Math.max(considered, 1) >= 0.1)),
    examples,
  };
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
  const documentOwners = new Map<string, string[]>();
  const existingNames = new Set<string>();

  for (const patient of existing) {
    if (patient.externalRef) byExternalRef.set(patient.externalRef, patient.id);
    if (patient.document) {
      const key = documentKey(patient.document);
      if (key) documentOwners.set(key, [...(documentOwners.get(key) ?? []), patient.id]);
    }
    existingNames.add(normalizePatientName(patient.fullName));
    if (patient.birthDate) {
      byNameBirth.set(`${normalizePatientName(patient.fullName)}|${patient.birthDate}`, patient.id);
    }
  }

  // A key already held by two charts here is not an identity — it is a
  // placeholder the old system typed for everyone without one, and matching it
  // would write this row into whichever of them came first.
  for (const [key, owners] of documentOwners) {
    if (owners.length === 1) byDocument.set(key, owners[0]);
  }

  const seenExternalRef = new Map<string, number>();
  const seenDocument = new Map<string, number>();
  const columnWarnings: RowIssue[] = [];
  const rows: StagedRow[] = [];
  // Counted so the wizard can say ONCE that the column she mapped as the
  // document does not hold documents, instead of warning on each of 300 rows.
  // "Holds documents" means digits: an RG column is a correct mapping and must
  // not be reported as a wrong one just because an RG never merges charts.
  let documentCells = 0;
  let documentLike = 0;

  // A document shared by DIFFERENT people in the same file is a placeholder
  // ("123.456.789-09" typed for everyone who had none — and that CPF is valid),
  // not an identity. The check-digit rule alone would let it through, and forty
  // strangers would collapse into one chart.
  const namesByDocument = new Map<string, Set<string>>();
  if (mapping.document !== undefined) {
    for (const row of table.rows) {
      const value = normalizeDocument(row[mapping.document] ?? "").value;
      const key = value ? documentKey(value) : null;
      const primary = normalizeFullName(mapping.full_name === undefined ? "" : (row[mapping.full_name] ?? ""));
      const last = surnameColumn === undefined ? "" : normalizeFullName(row[surnameColumn] ?? "");
      const name = normalizePatientName([primary, last].filter((piece) => piece !== "").join(" "));
      if (!key || name === "") continue;
      namesByDocument.set(key, (namesByDocument.get(key) ?? new Set<string>()).add(name));
    }
  }
  const sharedDocuments = new Set([...namesByDocument].filter(([, names]) => names.size > 1).map(([key]) => key));

  const birthHeader = mapping.birth_date === undefined ? undefined : table.headers[mapping.birth_date];
  if (mapping.birth_date !== undefined && !dateOrder) {
    columnWarnings.push({ code: "date_order_unresolved", field: "birth_date", header: birthHeader });
  }

  table.rows.forEach((row, index) => {
    const rowNumber = index + HEADER_ROW_OFFSET;
    const cell = (position?: number) => (position === undefined ? "" : readCell(row[position]));

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
    if (document.value) {
      normalized.document = document.value;
      documentCells += 1;
      if (looksLikeDocument(document.value)) documentLike += 1;
    }
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

    let docKey = normalized.document ? documentKey(normalized.document) : null;
    if (docKey && sharedDocuments.has(docKey)) {
      warnings.push({ code: "document_shared", field: "document" });
      docKey = null;
    }

    const duplicateOf = (externalRef && seenExternalRef.get(externalRef)) || (docKey && seenDocument.get(docKey));

    if (duplicateOf) {
      staged.action = "skip";
      staged.errorCode = "duplicate_in_file";
      rows.push(staged);
      return;
    }

    if (externalRef) seenExternalRef.set(externalRef, rowNumber);
    if (docKey) seenDocument.set(docKey, rowNumber);

    const matchedByRef = externalRef ? byExternalRef.get(externalRef) : undefined;
    const matchedByDocument = docKey ? byDocument.get(docKey) : undefined;
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
    } else if (existingNames.has(normalizePatientName(fullName))) {
      // Not merged — a name is not an identity — but never silent: without a
      // CPF or the old system's code, a re-import would otherwise open a second
      // chart for someone already here without a word.
      warnings.push({ code: "name_exists_in_practice", field: "full_name" });
    }

    rows.push(staged);
  });

  if (mapping.document !== undefined && documentCells >= 3 && documentLike * 2 < documentCells) {
    columnWarnings.push({
      code: "document_not_documents",
      field: "document",
      header: table.headers[mapping.document],
    });
  }

  // Marked on the SECOND occurrence and after, so the line she reads is the one
  // that duplicates a chart, not the one that opened it.
  const seenName = new Set<string>();
  for (const row of rows) {
    if (row.action !== "create") continue;
    const key = normalizePatientName(row.normalized.full_name ?? "");
    if (key === "") continue;
    if (seenName.has(key)) row.warnings.push({ code: "name_repeated_in_file", field: "full_name" });
    else seenName.add(key);
  }

  const summary = { create: 0, update: 0, skip: 0, error: 0 };
  for (const row of rows) summary[row.action] += 1;

  return { rows, summary, columnWarnings, repeatedNames: assessRepeatedNames(rows) };
}
