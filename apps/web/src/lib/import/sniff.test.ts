import { REJECTION_MESSAGE_KEY, sniffSpreadsheet, type SpreadsheetRejection } from "./sniff";
import { describe, expect, it } from "vitest";

import de from "@flyee/content/messages/de.json";
import en from "@flyee/content/messages/en.json";
import es from "@flyee/content/messages/es.json";
import fr from "@flyee/content/messages/fr.json";
import ptBR from "@flyee/content/messages/pt-BR.json";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

/** Bytes as a windows-1252 export would write them. */
function latin1(text: string): Uint8Array {
  return Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
}

describe("spreadsheet sniffing", () => {
  it("names the Excel workbook instead of parsing the zip", () => {
    expect(sniffSpreadsheet(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00))).toBe("xlsx");
  });

  it("recognizes the old .xls compound file", () => {
    expect(sniffSpreadsheet(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00))).toBe("legacy-office");
  });

  it("recognizes a PDF, which is the other thing systems export", () => {
    expect(sniffSpreadsheet(new TextEncoder().encode("%PDF-1.7\n"))).toBe("pdf");
  });

  it("recognizes Excel's Unicode text export by its BOM", () => {
    expect(sniffSpreadsheet(bytes(0xff, 0xfe, 0x6e, 0x00, 0x6f, 0x00))).toBe("utf-16");
    expect(sniffSpreadsheet(bytes(0xfe, 0xff, 0x00, 0x6e, 0x00, 0x6f))).toBe("utf-16");
  });

  it("falls back to generic advice for anything else binary", () => {
    // A PNG: no signature of ours, but NUL bytes in its header.
    expect(sniffSpreadsheet(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d))).toBe(
      "binary",
    );
  });

  it("catches UTF-16 written without a BOM through its NUL bytes", () => {
    expect(sniffSpreadsheet(bytes(0x6e, 0x00, 0x6f, 0x00, 0x6d, 0x00, 0x65, 0x00))).toBe("binary");
  });

  it("accepts a UTF-8 CSV", () => {
    expect(sniffSpreadsheet(new TextEncoder().encode("nome;nascimento\nMárcia;03/04/1985"))).toBeNull();
  });

  it("accepts a CSV with a UTF-8 BOM, which Excel writes", () => {
    const withBom = bytes(0xef, 0xbb, 0xbf, ...new TextEncoder().encode("nome;telefone\nMárcia;11999990000"));
    expect(sniffSpreadsheet(withBom)).toBeNull();
  });

  it("accepts a latin-1 CSV — high bytes are not a binary signal", () => {
    expect(sniffSpreadsheet(latin1("nome;cidade\nJoão;São Paulo\nMárcia;Brasília"))).toBeNull();
  });

  it("accepts an empty file, which the row check answers with a better message", () => {
    expect(sniffSpreadsheet(bytes())).toBeNull();
  });

  it("only scans the head, so a long CSV stays cheap and accepted", () => {
    const long = new TextEncoder().encode("nome;telefone\n" + "Márcia;11999990000\n".repeat(5000));
    expect(long.length).toBeGreaterThan(8192);
    expect(sniffSpreadsheet(long)).toBeNull();
  });
});

describe("rejection messages", () => {
  const CATALOGS: Record<string, { product: Record<string, string> }> = {
    "pt-BR": ptBR,
    en,
    es,
    fr,
    de,
  };

  const rejections = Object.keys(REJECTION_MESSAGE_KEY) as SpreadsheetRejection[];

  it.each(Object.keys(CATALOGS))("resolves every rejection in %s", (locale) => {
    const product = CATALOGS[locale].product;
    for (const rejection of rejections) {
      const message = product[REJECTION_MESSAGE_KEY[rejection]];
      expect(message, `${locale} is missing ${REJECTION_MESSAGE_KEY[rejection]}`).toBeTruthy();
    }
  });

  it("says what to do, not just that the file is wrong", () => {
    // The whole point of the guard: naming the format is useless without the
    // action that fixes it, so every message mentions CSV.
    for (const rejection of rejections) {
      expect(CATALOGS["pt-BR"].product[REJECTION_MESSAGE_KEY[rejection]]).toMatch(/CSV/);
    }
  });
});
