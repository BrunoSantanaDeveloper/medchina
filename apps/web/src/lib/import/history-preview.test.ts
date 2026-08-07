import { resolveDateOrder } from "./dates";
import { buildHistoryPreview } from "./history-preview";
import { guessColumnMapping } from "./mapping";
import { columnValues, parseSpreadsheet } from "./parse";
import type { ExistingPatient } from "./types";
import { describe, expect, it } from "vitest";

const EXPORT = [
  "Código;Paciente;Data do atendimento;Evolução;Sistema",
  "H-1;Márcia da Silva;14/03/2019;Queixa: lombalgia. Conduta: BL23.;Sistema Anterior",
  "H-2;Ana Prado;02/12/2020;Insônia. Pontos HT7, SP6.;Sistema Anterior",
  "H-3;Fulana Inexistente;05/05/2021;Registro órfão;Sistema Anterior",
  "H-4;Márcia da Silva;;Sem data;Sistema Anterior",
  "H-5;Márcia da Silva;01/02/2021;;Sistema Anterior",
  "H-1;Márcia da Silva;14/03/2019;Repetida no arquivo;Sistema Anterior",
].join("\n");

const existing: ExistingPatient[] = [
  { id: "p-marcia", externalRef: "A-10", document: null, fullName: "Márcia da Silva", birthDate: "1985-04-03" },
  { id: "p-ana", externalRef: null, document: null, fullName: "Ana Prado", birthDate: null },
];

function previewFrom(patients: ExistingPatient[] = existing) {
  const table = parseSpreadsheet(new TextEncoder().encode(EXPORT));
  const { mapping } = guessColumnMapping(table.headers, "history");
  const verdict = resolveDateOrder(columnValues(table, mapping.date ?? -1));
  return {
    table,
    mapping,
    verdict,
    preview: buildHistoryPreview({ table, mapping, dateOrder: verdict.order ?? undefined, existing: patients }),
  };
}

describe("history import mapping", () => {
  it("reads a history sheet's columns, not a patient sheet's", () => {
    const { mapping, table } = previewFrom();
    expect(table.headers[mapping.patient_name ?? -1]).toBe("Paciente");
    expect(table.headers[mapping.date ?? -1]).toBe("Data do atendimento");
    expect(table.headers[mapping.body ?? -1]).toBe("Evolução");
    expect(table.headers[mapping.external_ref ?? -1]).toBe("Código");
    expect(table.headers[mapping.source ?? -1]).toBe("Sistema");
  });

  it("resolves the date order from the column, like every other date", () => {
    expect(previewFrom().verdict).toMatchObject({ order: "dmy" });
  });
});

describe("history import preview", () => {
  it("attaches a record to the patient it names", () => {
    const [first] = previewFrom().preview.rows;
    expect(first.action).toBe("create");
    expect(first.targetType).toBe("consultation");
    expect(first.normalized).toMatchObject({
      patient_id: "p-marcia",
      date: "2019-03-14",
      body: "Queixa: lombalgia. Conduta: BL23.",
      external_ref: "H-1",
      source: "Sistema Anterior",
    });
  });

  it("refuses a record whose patient is not here — a chart is not created from a history line", () => {
    const row = previewFrom().preview.rows[2];
    expect(row.action).toBe("error");
    expect(row.errorCode).toBe("patient_not_found");
  });

  it("refuses an undated record instead of filing it as today", () => {
    const row = previewFrom().preview.rows[3];
    expect(row.action).toBe("error");
    expect(row.errorCode).toBe("record_date_required");
  });

  it("refuses a line with no text — there is no record in it", () => {
    const row = previewFrom().preview.rows[4];
    expect(row.action).toBe("error");
    expect(row.errorCode).toBe("legacy_body_required");
  });

  it("skips the same record repeated inside the file", () => {
    const row = previewFrom().preview.rows[5];
    expect(row.action).toBe("skip");
    expect(row.errorCode).toBe("duplicate_in_file");
  });

  it("holds a homonym rather than filing the record in one of the two charts", () => {
    const row = previewFrom([
      ...existing,
      { id: "p-marcia-2", externalRef: null, document: null, fullName: "Marcia da Silva", birthDate: "1990-01-01" },
    ]).preview.rows[0];
    expect(row.action).toBe("error");
    expect(row.errorCode).toBe("patient_ambiguous");
  });

  it("prefers the old system's id over the name when both are present", () => {
    const table = parseSpreadsheet(
      new TextEncoder().encode(
        ["Id paciente;Paciente;Data;Evolução", "A-10;Nome Que Nao Bate;14/03/2019;Texto"].join("\n"),
      ),
    );
    const { mapping } = guessColumnMapping(table.headers, "history");
    const preview = buildHistoryPreview({ table, mapping, dateOrder: "dmy", existing });
    expect(preview.rows[0].normalized.patient_id).toBe("p-marcia");
  });

  it("counts what will happen before anything is written", () => {
    expect(previewFrom().preview.summary).toEqual({ create: 2, update: 0, skip: 1, error: 3 });
  });

  it("never guesses an unresolved date column", () => {
    const { table, mapping } = previewFrom();
    const preview = buildHistoryPreview({ table, mapping, dateOrder: undefined, existing });
    expect(preview.columnWarnings.map((warning) => warning.code)).toEqual(["date_order_unresolved"]);
    expect(preview.rows[0].action).toBe("error");
  });
});
