import type { SpreadsheetEncoding } from "./types";

/**
 * Bytes -> text, for spreadsheets that were not written with us in mind.
 *
 * Systems used by Brazilian practices routinely export CSV as **latin-1**
 * (windows-1252), and Excel's "CSV (separado por vírgulas)" on a pt-BR machine
 * does the same. Reading those bytes as UTF-8 does not fail loudly: it yields
 * "Mrcia" or "MÃ¡rcia" — a patient's name, corrupted permanently, in a chart
 * nobody will re-check. So the encoding is decided by evidence, not assumed:
 * strict UTF-8 first (it REJECTS invalid sequences instead of substituting
 * U+FFFD), windows-1252 when that rejection happens.
 *
 * The BOM is stripped because it would otherwise become part of the first
 * header — an invisible U+FEFF glued to "nome", which then matches nothing.
 */

const BOM = [0xef, 0xbb, 0xbf];

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && BOM.every((byte, index) => bytes[index] === byte);
}

export function decodeSpreadsheet(bytes: Uint8Array): { text: string; encoding: SpreadsheetEncoding } {
  const body = hasUtf8Bom(bytes) ? bytes.subarray(BOM.length) : bytes;

  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf-8" };
  } catch {
    // Not valid UTF-8: the only other encoding these exports use in practice.
    // windows-1252 never fails, so this branch always produces something —
    // which is why the detected encoding is reported back and shown in the
    // preview, where a wrong guess is visible in the sample rows.
    return { text: new TextDecoder("windows-1252").decode(body), encoding: "windows-1252" };
  }
}
