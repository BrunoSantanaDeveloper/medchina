/**
 * "Is this even a CSV?" — decided from the bytes, before decoding.
 *
 * `accept=".csv"` on the file input only FILTERS the picker: every OS dialog
 * offers "all files", so an `.xlsx` reaches us routinely. Without this check the
 * failure is silent and expensive: a zip container decodes as windows-1252
 * (that decoder never fails), Papa Parse finds a delimiter somewhere in the
 * compressed stream, and the wizard cheerfully offers mojibake as column names.
 * Nothing is written — the mapping step is a confirmation — but the person is
 * left guessing what she did wrong.
 *
 * So the formats she actually mistakes for a CSV are named, each with the one
 * action that fixes it. The list is closed on purpose: anything unrecognized
 * falls through to the NUL-byte test below and gets the generic advice, and a
 * real CSV is never rejected (a text export in UTF-8 or latin-1 has no NUL).
 */

export type SpreadsheetRejection =
  | /** Zip container: .xlsx, .ods, and a plain .zip of exported files. */ "xlsx"
  | /** OLE2 compound file: the old .xls and .doc. */ "legacy-office"
  | "pdf"
  /** Excel's "Texto Unicode (*.txt)": tab-delimited, but UTF-16. */
  | "utf-16"
  | "binary";

type Signature = { bytes: number[]; rejection: SpreadsheetRejection };

const SIGNATURES: Signature[] = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], rejection: "xlsx" },
  { bytes: [0x50, 0x4b, 0x05, 0x06], rejection: "xlsx" }, // empty archive
  { bytes: [0x50, 0x4b, 0x07, 0x08], rejection: "xlsx" }, // spanned archive
  { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], rejection: "legacy-office" },
  { bytes: [0x25, 0x50, 0x44, 0x46], rejection: "pdf" }, // %PDF
  { bytes: [0xff, 0xfe], rejection: "utf-16" }, // UTF-16LE BOM
  { bytes: [0xfe, 0xff], rejection: "utf-16" }, // UTF-16BE BOM
];

/**
 * The `product` message each rejection is explained with. It lives next to the
 * codes so a new format cannot be added without its advice, and so a test can
 * assert every key exists in every locale — a dynamic `t(key)` fails at runtime,
 * in front of the person already stuck on an import.
 */
export const REJECTION_MESSAGE_KEY: Record<SpreadsheetRejection, string> = {
  xlsx: "import-file-not-csv-excel",
  "legacy-office": "import-file-not-csv-office",
  pdf: "import-file-not-csv-pdf",
  "utf-16": "import-file-not-csv-utf16",
  binary: "import-file-not-csv",
};

/** Enough to catch the header of anything binary without reading a 50 MB file. */
const SCAN_LIMIT = 8192;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

/** The rejection to explain, or `null` when the bytes may be parsed as text. */
export function sniffSpreadsheet(bytes: Uint8Array): SpreadsheetRejection | null {
  const signature = SIGNATURES.find((candidate) => startsWith(bytes, candidate.bytes));
  if (signature) return signature.rejection;

  // Catches UTF-16 without a BOM, images, sqlite/access databases — whatever
  // else lands here. Checked AFTER the signatures so the named formats keep
  // their specific advice.
  const scanned = bytes.length > SCAN_LIMIT ? bytes.subarray(0, SCAN_LIMIT) : bytes;
  if (scanned.includes(0x00)) return "binary";

  return null;
}
