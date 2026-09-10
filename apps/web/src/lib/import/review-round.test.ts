import { fetchExistingPatients } from "./commit";
import { guessColumnMapping } from "./mapping";
import { parseCsvText } from "./parse";
import { assessRepeatedNames, buildImportPreview } from "./preview";
import type { ExistingPatient, ImportKind, StagedRow } from "./types";
import { describe, expect, it } from "vitest";

import { isValidCpf } from "@flyee/fields";

/**
 * Pinned by an adversarial review of the fix for the attendance-sheet
 * incident. Each case here was reproduced against the real code before it was
 * fixed — several were regressions introduced by that fix itself, which is the
 * point of keeping them.
 */

function resolve(headers: string[], kind: ImportKind = "patients") {
  const { mapping } = guessColumnMapping(headers, kind);
  const named: Record<string, string> = {};
  for (const [field, index] of Object.entries(mapping)) {
    if (typeof index === "number") named[field] = headers[index];
  }
  return named;
}

function previewOf(csv: string, existing: ExistingPatient[] = []) {
  const table = parseCsvText(csv, "utf-8");
  const { mapping, surnameColumn } = guessColumnMapping(table.headers, "patients");
  return buildImportPreview({ table, mapping, surnameColumn, dateOrder: "dmy", existing });
}

const codesOf = (row: StagedRow) => [...(row.errorCode ? [row.errorCode] : []), ...row.warnings.map((w) => w.code)];

const stagedName = (fullName: string): StagedRow => ({
  rowNumber: 2,
  raw: {},
  normalized: { full_name: fullName },
  action: "create",
  warnings: [],
});

const patient = (id: string, fullName: string, document: string | null = null): ExistingPatient => ({
  id,
  fullName,
  document,
  externalRef: null,
  birthDate: null,
});

/** A valid CPF that starts with 0 — the digit Excel drops. */
function cpfStartingWithZero(): string {
  for (let suffix = 0; suffix < 100; suffix++) {
    const cpf = "012345678" + String(suffix).padStart(2, "0");
    if (isValidCpf(cpf)) return cpf;
  }
  throw new Error("no valid CPF with this base");
}

describe("headers that must map the way a person reads them", () => {
  it("reads 'Cód. Paciente' as the old system's id, never as her name", () => {
    // It used to become every chart's NAME — "1024", "1025" — and the real
    // "Nome" column was discarded; the repeated-name gate is blind to it
    // because codes are unique.
    expect(resolve(["Cód. Paciente", "Nome", "CPF", "Telefone"])).toMatchObject({
      full_name: "Nome",
      external_ref: "Cód. Paciente",
    });
  });

  it.each(["Nº Atendimento", "Num Atendimento", "Nro Atendimento"])(
    "never offers %s as the body of a frozen record",
    (header) => {
      expect(resolve([header, "Paciente", "Data", "Relato"], "history")).toMatchObject({
        body: "Relato",
        external_ref: header,
      });
    },
  );

  it("still reads text that merely mentions the visit as the text", () => {
    // "no" is a preposition here, not "número".
    expect(resolve(["Paciente", "Data", "Relato no atendimento"], "history").body).toBe("Relato no atendimento");
  });

  it("reads a glued legacy date instead of handing it to the body", () => {
    expect(resolve(["DtAtendimento", "Paciente", "Evolucao"], "history")).toMatchObject({
      date: "DtAtendimento",
      body: "Evolucao",
    });
  });

  it.each(["Nº Docto", "Docto", "Document Number", "Identity Document", "Registro Geral"])(
    "claims %s as the document",
    (header) => {
      expect(resolve(["Nome", header]).document).toBe(header);
    },
  );

  it("never makes the RG the old system's id", () => {
    expect(resolve(["Registro Geral", "Nome do Paciente", "CPF"]).external_ref).toBeUndefined();
  });

  it("does not read a weekday as the appointment date", () => {
    expect(resolve(["Dia da Semana", "Data", "Hora", "Paciente"], "schedule").date).toBe("Data");
  });

  it("does not mistake 'recepção' for a postcode", () => {
    expect(resolve(["Nome do Paciente (Recepção)", "CPF"]).full_name).toBe("Nome do Paciente (Recepção)");
  });
});

describe("what may merge two charts", () => {
  it("does not let a valid placeholder CPF shared by strangers merge them", () => {
    // 123.456.789-09 passes the check digit, and is exactly what old systems
    // typed for everyone without a CPF.
    expect(isValidCpf("12345678909")).toBe(true);
    const preview = previewOf(
      ["Nome;CPF", "Ana Souza;123.456.789-09", "Bia Lima;123.456.789-09", "Cris Dias;123.456.789-09"].join("\n"),
    );
    expect(preview.summary).toEqual({ create: 3, update: 0, skip: 0, error: 0 });
    expect(preview.rows.every((row) => codesOf(row).includes("document_shared"))).toBe(true);
  });

  it("still recognizes the same person listed twice with her real CPF", () => {
    const preview = previewOf(["Nome;CPF", "Ana Souza;529.982.247-25", "Ana Souza;529.982.247-25"].join("\n"));
    expect(preview.rows[1]).toMatchObject({ action: "skip", errorCode: "duplicate_in_file" });
  });

  it("never merges on the all-zero placeholder", () => {
    const preview = previewOf(["Nome;CPF", "Ana Souza;000.000.000-00"].join("\n"), [
      patient("placeholder-holder", "Outra Pessoa", "00000000000"),
    ]);
    expect(preview.rows[0].action).toBe("create");
  });

  it("does not pick one of two charts that already share a CPF", () => {
    const preview = previewOf(["Nome;CPF", "Ana Souza;529.982.247-25"].join("\n"), [
      patient("first", "Primeira", "52998224725"),
      patient("second", "Segunda", "529.982.247-25"),
    ]);
    expect(preview.rows[0].action).toBe("create");
  });

  it("restores the leading zero Excel dropped, and still finds the chart", () => {
    const cpf = cpfStartingWithZero();
    const eaten = cpf.slice(1);
    const preview = previewOf(["Nome;CPF", `Ana Souza;${eaten}`].join("\n"), [
      // Stored by an earlier import, before the zero was restored.
      patient("stored-earlier", "Ana Souza", eaten),
    ]);
    expect(preview.rows[0].normalized.document).toBe(cpf);
    expect(preview.rows[0]).toMatchObject({ action: "update", targetId: "stored-earlier" });
  });

  it("warns — never merges — when the name alone is already in the practice", () => {
    const preview = previewOf(["Nome;Telefone", "Ana Souza;11999990000"].join("\n"), [
      patient("already-here", "Ana Souza"),
    ]);
    expect(preview.rows[0].action).toBe("create");
    expect(codesOf(preview.rows[0])).toContain("name_exists_in_practice");
  });

  it("does not report a column of RGs as a wrong mapping", () => {
    const preview = previewOf(
      ["Nome;RG", "Ana Souza;12.345.678-9", "Bia Lima;23.456.789-0", "Cris Dias;34.567.890-1"].join("\n"),
    );
    expect(preview.columnWarnings).toEqual([]);
  });
});

describe("the gate is proportional to the file", () => {
  it("stays quiet for three homonyms in a registry of two thousand", () => {
    const rows = [
      ...Array.from({ length: 1997 }, (_, i) => stagedName(`Pessoa ${i}`)),
      stagedName("Maria Silva"),
      stagedName("Maria Silva"),
      stagedName("Maria Silva"),
    ];
    expect(assessRepeatedNames(rows)).toMatchObject({ repeated: 2, maxPerName: 3, suspicious: false });
  });

  it("stops a file where one person holds a tenth of the lines", () => {
    const rows = [
      ...Array.from({ length: 90 }, (_, i) => stagedName(`Pessoa ${i}`)),
      ...Array.from({ length: 10 }, () => stagedName("Maria Silva")),
    ];
    expect(assessRepeatedNames(rows)).toMatchObject({ maxPerName: 10, suspicious: true });
  });
});

describe("the charts she already has are all loaded", () => {
  function fakeClient(total: number, serverCap: number) {
    const rows = Array.from({ length: total }, (_, i) => ({
      id: `p-${String(i).padStart(5, "0")}`,
      full_name: `Paciente ${i}`,
      birth_date: null,
      document: null,
      external_ref: null,
      archived_at: i % 10 === 0 ? "2026-01-01T00:00:00Z" : null,
    }));
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range: async (from: number, to: number) => ({
        data: rows.slice(from, Math.min(to + 1, from + serverCap)),
        error: null,
      }),
    };
    return { from: () => query };
  }

  it("past the thousand rows one page returns", async () => {
    const result = await fetchExistingPatients(fakeClient(2500, 1000) as never, "org");
    expect(result.ok && result.data.length).toBe(2500);
  });

  it("even when the server caps pages below the size asked for", async () => {
    const result = await fetchExistingPatients(fakeClient(2500, 400) as never, "org");
    expect(result.ok && result.data.length).toBe(2500);
  });

  it("and knows which ones are archived", async () => {
    const result = await fetchExistingPatients(fakeClient(30, 1000) as never, "org");
    expect(result.ok && result.data.filter((row) => row.archived).length).toBe(3);
  });
});
