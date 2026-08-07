import type { PatientFieldKey, RowIssue } from "./types";

import { isValidCnpj, isValidCpf, isValidPhoneBr, onlyDigits } from "@flyee/fields";

/**
 * Cell -> the value that goes into the chart, or nothing.
 *
 * The rule behind every function here: when a value cannot be trusted, prefer
 * ABSENCE with a warning over storing something wrong. A dropped phone number
 * is visible in the preview and fixable; a garbage phone number in a chart
 * looks like data and gets dialled.
 *
 * The one exception is the document, argued at its own function.
 */

export type NormalizedValue = { value?: string; warning?: RowIssue };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function issue(code: string, field: PatientFieldKey): RowIssue {
  return { code, field };
}

/** Names keep their accents and case; only whitespace is tidied. */
export function normalizeFullName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function normalizeNotes(raw: string): string | undefined {
  const value = raw.trim().replace(/\s+\n/g, "\n");
  return value === "" ? undefined : value;
}

export function normalizeEmail(raw: string): NormalizedValue {
  const value = raw.trim().toLowerCase();
  if (value === "") return {};
  if (!EMAIL_PATTERN.test(value)) return { warning: issue("email_not_recognized", "email") };
  return { value };
}

/**
 * Phones are stored as digits (packages/fields' contract). A country code is
 * stripped because exports carry it inconsistently, and anything that is not a
 * Brazilian landline/mobile is dropped rather than stored half-right.
 */
export function normalizePhone(raw: string): NormalizedValue {
  if (raw.trim() === "") return {};
  let digits = onlyDigits(raw);
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  if (!isValidPhoneBr(digits)) return { warning: issue("phone_not_recognized", "phone") };
  return { value: digits };
}

/**
 * Documents are the exception to "drop what you cannot trust": this is the
 * field she reconciles two systems by, so losing it is worse than keeping a
 * flagged one. A CPF/CNPJ-shaped value is stored as digits (never a mask); a
 * failed check digit is kept AND warned, because it is almost always a typo
 * carried over from the old system and she is the one who can fix it. Anything
 * else (an RG, a foreign document) keeps its original characters, which digits
 * would destroy.
 */
export function normalizeDocument(raw: string): NormalizedValue {
  const trimmed = raw.trim();
  if (trimmed === "") return {};

  const digits = onlyDigits(trimmed);
  if (digits.length === 11) {
    return isValidCpf(digits) ? { value: digits } : { value: digits, warning: issue("cpf_check_failed", "document") };
  }
  if (digits.length === 14) {
    return isValidCnpj(digits) ? { value: digits } : { value: digits, warning: issue("cnpj_check_failed", "document") };
  }
  return { value: trimmed };
}

/** The old system's identifier: trimmed, never interpreted. */
export function normalizeExternalRef(raw: string): string | undefined {
  const value = raw.trim();
  return value === "" ? undefined : value;
}
