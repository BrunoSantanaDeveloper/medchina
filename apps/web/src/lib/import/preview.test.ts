import { resolveDateOrder } from "./dates";
import { guessColumnMapping } from "./mapping";
import { columnValues, parseSpreadsheet } from "./parse";
import { buildImportPreview } from "./preview";
import type { ExistingPatient } from "./types";
import { describe, expect, it } from "vitest";

/** Bytes as a windows-1252 export would write them. */
function latin1(text: string): Uint8Array {
  return Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
}

// A file shaped like what actually comes out of a Brazilian practice system:
// semicolons, latin-1, split name, a mother's-name column, and a CPF that was
// typed wrong years ago.
const EXPORT = [
  "Código;Nome;Sobrenome;Data de Nascimento;CPF;Celular;E-mail;Nome da mãe;Observações",
  "A-10;Márcia;da Silva;03/04/1985;529.982.247-25;(11) 99999-0000;MARCIA@EXEMPLO.COM;Conceição;Lombalgia crônica",
  "A-11;João;Nogueira;25/12/1990;111.111.111-11;5511988887777;;Antônia;",
  "A-12;;Sem Nome;01/02/2000;;;;;",
  "A-11;João;Nogueira;25/12/1990;;;;;",
  "A-13;Ana;Prado;07/07/1979;;telefone antigo;ana(arroba)exemplo;;",
].join("\n");

function previewFrom(existing: ExistingPatient[] = []) {
  const table = parseSpreadsheet(latin1(EXPORT));
  const { mapping, surnameColumn } = guessColumnMapping(table.headers);
  const verdict = resolveDateOrder(columnValues(table, mapping.birth_date ?? -1));
  return {
    table,
    mapping,
    surnameColumn,
    verdict,
    preview: buildImportPreview({
      table,
      mapping,
      surnameColumn,
      dateOrder: verdict.order ?? undefined,
      existing,
    }),
  };
}

describe("import preview over a real-shaped export", () => {
  it("maps the patient's own columns and leaves the mother's name out", () => {
    const { mapping, surnameColumn, table } = previewFrom();
    expect(table.headers[mapping.full_name ?? -1]).toBe("Nome");
    expect(table.headers[surnameColumn ?? -1]).toBe("Sobrenome");
    expect(table.headers[mapping.birth_date ?? -1]).toBe("Data de Nascimento");
    expect(table.headers[mapping.external_ref ?? -1]).toBe("Código");
    expect(Object.values(mapping)).not.toContain(table.headers.indexOf("Nome da mãe"));
  });

  it("resolves the date column from evidence in the file", () => {
    expect(previewFrom().verdict).toMatchObject({ order: "dmy", reason: "day_over_12" });
  });

  it("joins the split name and keeps its accents", () => {
    const [first] = previewFrom().preview.rows;
    expect(first.normalized.full_name).toBe("Márcia da Silva");
    expect(first.normalized.birth_date).toBe("1985-04-03");
  });

  it("stores contact data as digits and lowercase, never as typed", () => {
    const [first] = previewFrom().preview.rows;
    expect(first.normalized.phone).toBe("11999990000");
    expect(first.normalized.email).toBe("marcia@exemplo.com");
    expect(first.normalized.document).toBe("52998224725");
  });

  it("strips the country code an export tacked on", () => {
    const row = previewFrom().preview.rows[1];
    expect(row.normalized.phone).toBe("11988887777");
  });

  it("keeps a failing CPF but flags it — she is the one who can fix it", () => {
    const row = previewFrom().preview.rows[1];
    expect(row.normalized.document).toBe("11111111111");
    expect(row.warnings.map((warning) => warning.code)).toContain("cpf_check_failed");
  });

  it("drops a phone and an e-mail it cannot read rather than storing garbage", () => {
    const row = previewFrom().preview.rows[4];
    expect(row.normalized.phone).toBeUndefined();
    expect(row.normalized.email).toBeUndefined();
    expect(row.warnings.map((warning) => warning.code)).toEqual(["phone_not_recognized", "email_not_recognized"]);
  });

  it("never writes an empty cell as an answer", () => {
    const row = previewFrom().preview.rows[1];
    expect(Object.keys(row.normalized)).not.toContain("notes");
    expect(Object.keys(row.normalized)).not.toContain("email");
  });

  it("refuses a line with no name, pointing at the spreadsheet line she sees", () => {
    const row = previewFrom().preview.rows[2];
    expect(row.action).toBe("error");
    expect(row.errorCode).toBe("full_name_required");
    expect(row.rowNumber).toBe(4);
  });

  it("does not let a surname rescue a row whose name cell is empty", () => {
    // The line carries "Sem Nome" in the surname column: joining it would
    // create a chart named after a fragment, which nobody finds again.
    const row = previewFrom().preview.rows[2];
    expect(row.normalized.full_name).toBeUndefined();
  });

  it("skips the second copy of the same person inside the file", () => {
    const row = previewFrom().preview.rows[3];
    expect(row.action).toBe("skip");
    expect(row.errorCode).toBe("duplicate_in_file");
  });

  it("counts what will happen before anything is written", () => {
    expect(previewFrom().preview.summary).toEqual({ create: 3, update: 0, skip: 1, error: 1 });
  });
});

describe("matching against patients already in the workspace", () => {
  const existing: ExistingPatient[] = [
    {
      id: "patient-ref",
      externalRef: "A-10",
      document: null,
      fullName: "Marcia da Silva",
      birthDate: "1985-04-03",
    },
  ];

  it("updates on the old system's id", () => {
    const row = previewFrom(existing).preview.rows[0];
    expect(row.action).toBe("update");
    expect(row.targetId).toBe("patient-ref");
  });

  it("updates on the same document", () => {
    const row = previewFrom([
      { id: "patient-doc", externalRef: null, document: "529.982.247-25", fullName: "M S", birthDate: null },
    ]).preview.rows[0];
    expect(row.action).toBe("update");
    expect(row.targetId).toBe("patient-doc");
  });

  it("does NOT merge a homonym with the same birth date — it holds the row for her", () => {
    const row = previewFrom([
      {
        id: "patient-homonym",
        externalRef: null,
        document: null,
        fullName: "Ana Prado",
        birthDate: "1979-07-07",
      },
    ]).preview.rows[4];
    expect(row.action).toBe("skip");
    expect(row.errorCode).toBe("possible_duplicate");
    expect(row.targetId).toBe("patient-homonym");
  });
});

describe("an unresolved date column", () => {
  const AMBIGUOUS = ["nome;nascimento", "Márcia;03/04/1985", "João;05/06/1990"].join("\n");

  it("never guesses: the value waits instead of entering the chart", () => {
    const table = parseSpreadsheet(new TextEncoder().encode(AMBIGUOUS));
    const { mapping } = guessColumnMapping(table.headers);
    const verdict = resolveDateOrder(columnValues(table, mapping.birth_date ?? -1));
    expect(verdict.ambiguous).toBe(true);

    const preview = buildImportPreview({ table, mapping, dateOrder: undefined, existing: [] });
    expect(preview.columnWarnings.map((warning) => warning.code)).toEqual(["date_order_unresolved"]);
    expect(preview.rows[0].normalized.birth_date).toBeUndefined();
    expect(preview.rows[0].warnings.map((warning) => warning.code)).toContain("birth_date_unresolved");
    // The patient still imports — only the date she has to confirm is held.
    expect(preview.rows[0].action).toBe("create");
  });
});
