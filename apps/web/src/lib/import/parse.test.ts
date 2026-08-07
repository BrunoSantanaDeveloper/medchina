import { decodeSpreadsheet } from "./decode";
import { parseCsvText, parseSpreadsheet } from "./parse";
import { describe, expect, it } from "vitest";

/** Bytes as a windows-1252 export would write them. */
function latin1(text: string): Uint8Array {
  return Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
}

describe("spreadsheet decoding", () => {
  it("reads a UTF-8 export", () => {
    const bytes = new TextEncoder().encode("nome\nMárcia");
    expect(decodeSpreadsheet(bytes)).toEqual({ text: "nome\nMárcia", encoding: "utf-8" });
  });

  it("reads a latin-1 export instead of corrupting the name", () => {
    const decoded = decodeSpreadsheet(latin1("nome\nMárcia Conceição"));
    expect(decoded.encoding).toBe("windows-1252");
    expect(decoded.text).toBe("nome\nMárcia Conceição");
  });

  it("strips the BOM so the first header still matches", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("nome")]);
    expect(decodeSpreadsheet(bytes).text).toBe("nome");
  });
});

describe("csv parsing", () => {
  it("detects the semicolon Brazilian exports use", () => {
    const table = parseCsvText("nome;nascimento\nMárcia;03/04/1985", "utf-8");
    expect(table.delimiter).toBe(";");
    expect(table.headers).toEqual(["nome", "nascimento"]);
    expect(table.rows).toEqual([["Márcia", "03/04/1985"]]);
  });

  it("keeps a quoted delimiter inside the field", () => {
    const table = parseCsvText('nome;obs\n"Silva, Márcia";"dor; lombar"', "utf-8");
    expect(table.rows).toEqual([["Silva, Márcia", "dor; lombar"]]);
  });

  it("still parses a comma-delimited file", () => {
    const table = parseCsvText("nome,telefone\nMárcia,11999990000", "utf-8");
    expect(table.delimiter).toBe(",");
    expect(table.rows).toEqual([["Márcia", "11999990000"]]);
  });

  it("drops trailing blank lines instead of importing an empty patient", () => {
    const table = parseCsvText("nome;telefone\nMárcia;11999990000\n;\n\n", "utf-8");
    expect(table.rows).toHaveLength(1);
  });

  it("parses bytes end to end, encoding included", () => {
    const table = parseSpreadsheet(latin1("nome;cidade\nJoão;São Paulo"));
    expect(table.encoding).toBe("windows-1252");
    expect(table.rows).toEqual([["João", "São Paulo"]]);
  });
});
