import { guessColumnMapping } from "./mapping";
import { parseCsvText } from "./parse";
import { assessRepeatedNames, buildImportPreview } from "./preview";
import type { ExistingPatient, ImportPreview, StagedRow } from "./types";
import { describe, expect, it } from "vitest";

/**
 * Who a row IS, and whether the file is a patient registry at all.
 *
 * Both questions were answered wrongly at once in a real incident: a practice
 * exported its ATTENDANCES and imported them as patients. Three people became
 * eight charts, and the engine reported `create: 8` with no error and no
 * warning — every safeguard it has was disarmed by the same file.
 */

function previewOf(csv: string, existing: ExistingPatient[] = []): ImportPreview {
  const table = parseCsvText(csv, "utf-8");
  const { mapping, surnameColumn } = guessColumnMapping(table.headers, "patients");
  return buildImportPreview({ table, mapping, surnameColumn, dateOrder: "dmy", existing });
}

const codesOf = (row: StagedRow) => [...(row.errorCode ? [row.errorCode] : []), ...row.warnings.map((w) => w.code)];

const ATTENDANCES = [
  "ID Atendimento;Paciente;Data;Procedimento;Descrição",
  "10234;Maria Aparecida da Silva;12/03/2025;Acupuntura;Lombalgia - 1a sessão",
  "10241;Maria Aparecida da Silva;26/03/2025;Acupuntura;Lombalgia - 2a sessão",
  "10258;Maria Aparecida da Silva;09/04/2025;Ventosaterapia;Ventosas lombares",
  "10277;Maria Aparecida da Silva;23/04/2025;Acupuntura;Manutenção mensal",
  "10262;João Carlos Menezes;10/04/2025;Auriculoterapia;Ansiedade",
  "10289;João Carlos Menezes;08/05/2025;Auriculoterapia;Reaplicação",
  "10295;Rita de Cássia Nogueira;15/05/2025;Moxabustão;Digestão lenta",
  "10311;Rita de Cássia Nogueira;29/05/2025;Acupuntura;Retorno",
].join("\n");

describe("an attendance sheet read as a patient registry", () => {
  const preview = previewOf(ATTENDANCES);

  it("is recognized by the one signal that does not depend on the headers", () => {
    // Three people on eight lines. Nothing about the column NAMES says this —
    // only the fact that the same person opens four charts.
    expect(preview.repeatedNames).toMatchObject({
      repeated: 5,
      considered: 8,
      maxPerName: 4,
      suspicious: true,
    });
  });

  it("names the people it would duplicate, instead of asserting a verdict", () => {
    expect(preview.repeatedNames?.examples).toEqual([
      "Maria Aparecida da Silva",
      "João Carlos Menezes",
      "Rita de Cássia Nogueira",
    ]);
  });

  it("marks the repeat on the second line, not on the one that opened the chart", () => {
    expect(codesOf(preview.rows[0])).not.toContain("name_repeated_in_file");
    expect(codesOf(preview.rows[1])).toContain("name_repeated_in_file");
    expect(preview.rows.filter((row) => codesOf(row).includes("name_repeated_in_file"))).toHaveLength(5);
  });
});

describe("a real patient registry is not mistaken for one", () => {
  // Twenty distinct people and one pair of homonyms — a practice really does
  // have two Ana Souzas, and refusing that file would break the feature.
  const REGISTRY = [
    "Código;Nome;Nascimento;CPF",
    ...Array.from({ length: 20 }, (_, i) => `P-${i};Paciente Número ${i};0${(i % 9) + 1}/03/1980;`),
    "P-99;Paciente Número 1;14/07/1991;",
  ].join("\n");

  it("does not flag a single pair sharing a name", () => {
    const { repeatedNames } = previewOf(REGISTRY);
    expect(repeatedNames).toMatchObject({ repeated: 1, maxPerName: 2, suspicious: false });
  });

  it("stays calm even with two such pairs, because the file is large", () => {
    const verdict = assessRepeatedNames([
      ...Array.from({ length: 30 }, (_, i) => stagedName(`Pessoa ${i}`)),
      stagedName("Pessoa 1"),
      stagedName("Pessoa 2"),
    ]);
    expect(verdict).toMatchObject({ repeated: 2, maxPerName: 2, suspicious: false });
  });

  it("but flags the same two repeats in a small file, where they are the shape", () => {
    const verdict = assessRepeatedNames([
      ...Array.from({ length: 6 }, (_, i) => stagedName(`Pessoa ${i}`)),
      stagedName("Pessoa 1"),
      stagedName("Pessoa 2"),
    ]);
    expect(verdict).toMatchObject({ repeated: 2, suspicious: true });
  });

  it("ignores rows that are not creating a chart", () => {
    const rows = [stagedName("Ana"), { ...stagedName("Ana"), action: "skip" as const }];
    expect(assessRepeatedNames(rows)).toMatchObject({ repeated: 0, suspicious: false });
  });
});

function stagedName(fullName: string): StagedRow {
  return { rowNumber: 2, raw: {}, normalized: { full_name: fullName }, action: "create", warnings: [] };
}

/**
 * The document is the ONLY field here that merges two charts automatically, so
 * what may serve as one is the narrowest question in the engine.
 */
describe("what may be used as an identity", () => {
  const ALLERGIES = [
    "Nome;Alergias",
    "Ana Souza;Nenhuma",
    "Bruna Lima;Nenhuma",
    "Carla Dias;Nenhuma",
    "Diva Melo;Dipirona",
  ].join("\n");

  it("no longer reads an allergy column as a document at all", () => {
    const table = parseCsvText(ALLERGIES, "utf-8");
    expect(guessColumnMapping(table.headers, "patients").mapping.document).toBeUndefined();
  });

  it("refuses free text as a merge key even when she maps it herself", () => {
    // She is allowed to map any column to any field; what she cannot do is
    // make "Nenhuma" identify a person.
    const table = parseCsvText(ALLERGIES, "utf-8");
    const preview = buildImportPreview({
      table,
      mapping: { full_name: 0, document: 1 },
      existing: [
        { id: "outra-pessoa", externalRef: null, document: "Nenhuma", fullName: "Zilda Outra", birthDate: null },
      ],
    });

    expect(preview.summary).toEqual({ create: 4, update: 0, skip: 0, error: 0 });
    expect(preview.rows.every((row) => row.action === "create")).toBe(true);
  });

  it("still stores the text — she reconciles two systems by reading it", () => {
    const table = parseCsvText(ALLERGIES, "utf-8");
    const preview = buildImportPreview({ table, mapping: { full_name: 0, document: 1 }, existing: [] });
    expect(preview.rows[0].normalized.document).toBe("Nenhuma");
  });

  it("says once that the column does not hold documents", () => {
    const table = parseCsvText(ALLERGIES, "utf-8");
    const preview = buildImportPreview({ table, mapping: { full_name: 0, document: 1 }, existing: [] });
    expect(preview.columnWarnings).toEqual([{ code: "document_not_documents", field: "document", header: "Alergias" }]);
  });

  it("keeps a CPF working as the identity it is", () => {
    const csv = ["Nome;CPF", "Ana Souza;529.982.247-25", "Bruna Lima;111.444.777-35"].join("\n");
    const preview = previewOf(csv, [
      { id: "ja-existe", externalRef: null, document: "52998224725", fullName: "A S", birthDate: null },
    ]);
    expect(preview.rows[0]).toMatchObject({ action: "update", targetId: "ja-existe" });
    expect(preview.columnWarnings).toEqual([]);
  });

  it("does not complain about a column of real documents", () => {
    const csv = ["Nome;CPF", "Ana Souza;529.982.247-25", "Bruna Lima;111.444.777-35", "Carla Dias;390.533.447-05"].join(
      "\n",
    );
    expect(previewOf(csv).columnWarnings).toEqual([]);
  });
});
