import { decodeSpreadsheet } from "./decode";
import type { ParsedTable, SpreadsheetEncoding } from "./types";
import Papa from "papaparse";

/**
 * CSV text -> a table of raw cells.
 *
 * Delimiter detection is left to Papa Parse (it scores candidates by field
 * count consistency across the first lines, which is what actually separates a
 * `;`-delimited file from one where a name contains a comma) and the result is
 * reported back so the preview can state what it decided. Quoted fields,
 * escaped quotes and embedded newlines are its problem, not ours — this is the
 * one place where hand-rolling would quietly lose a row.
 */

const DELIMITER_CANDIDATES = [";", ",", "\t", "|"];

export function parseCsvText(text: string, encoding: SpreadsheetEncoding, delimiterOverride?: string): ParsedTable {
  const result = Papa.parse<string[]>(text, {
    delimiter: delimiterOverride ?? "",
    delimitersToGuess: DELIMITER_CANDIDATES,
    skipEmptyLines: "greedy",
  });

  // A trailing blank line, or a row of empty cells left by the exporter, is
  // not a patient. Dropping them here keeps row numbering honest below.
  const rows = result.data.filter((row) => row.some((cell) => cell.trim() !== ""));
  const [headerRow = [], ...body] = rows;

  return {
    headers: headerRow.map((header) => header.trim()),
    rows: body,
    delimiter: result.meta.delimiter || delimiterOverride || ",",
    encoding,
  };
}

export function parseSpreadsheet(bytes: Uint8Array, delimiterOverride?: string): ParsedTable {
  const { text, encoding } = decodeSpreadsheet(bytes);
  return parseCsvText(text, encoding, delimiterOverride);
}

/** Column values of the parsed table, for column-level decisions (date order). */
export function columnValues(table: ParsedTable, index: number): string[] {
  return table.rows.map((row) => (row[index] ?? "").trim()).filter((value) => value !== "");
}
