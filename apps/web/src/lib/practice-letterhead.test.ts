import { letterheadLines } from "./practice-letterhead";
import { describe, expect, it } from "vitest";

/**
 * The whole point of this helper is what it does with ABSENCE: migration 0121
 * made every practice column nullable so accounts older than the screen keep
 * working, which means the letterhead has to survive any subset of the data
 * without printing an empty line, a dangling separator or a bare numeral.
 */
const LABELS = { cpf: "CPF", cnpj: "CNPJ" };

describe("letterheadLines", () => {
  it("prints nothing for a practice that filled nothing", () => {
    // The regression this guards: a document that used to show just the name
    // must keep showing just the name, not a row of separators.
    expect(letterheadLines({}, LABELS)).toEqual([]);
  });

  it("formats the stored digits for reading", () => {
    expect(
      letterheadLines(
        {
          document: "12345678000195",
          phone: "62999887766",
          email: "contato@clinica.test",
          postalCode: "74000000",
          street: "Rua das Flores",
          number: "120",
          complement: "Sala 3",
          district: "Setor Central",
          city: "Goiânia",
          state: "GO",
        },
        LABELS,
      ),
    ).toEqual([
      "CNPJ 12.345.678/0001-95",
      "Rua das Flores, 120 — Sala 3",
      "Setor Central · Goiânia/GO · 74000-000",
      "(62) 99988-7766 · contato@clinica.test",
    ]);
  });

  it("labels an 11-digit document as CPF", () => {
    expect(letterheadLines({ document: "39053344705" }, LABELS)).toEqual(["CPF 390.533.447-05"]);
  });

  it("drops a document that is neither, instead of printing it under a wrong label", () => {
    expect(letterheadLines({ document: "123" }, LABELS)).toEqual([]);
  });

  it("never prints the number without its street", () => {
    expect(letterheadLines({ number: "120", city: "Goiânia", state: "GO" }, LABELS)).toEqual(["Goiânia/GO"]);
  });

  it("closes the gap when a middle part is missing", () => {
    // district absent: the line must not open with a separator.
    expect(letterheadLines({ city: "Goiânia", state: "GO", postalCode: "74000000" }, LABELS)).toEqual([
      "Goiânia/GO · 74000-000",
    ]);
  });

  it("keeps a city that has no state and a state that has no city", () => {
    expect(letterheadLines({ city: "Goiânia" }, LABELS)).toEqual(["Goiânia"]);
    expect(letterheadLines({ state: "GO" }, LABELS)).toEqual(["GO"]);
  });

  it("prints whichever contact exists, alone", () => {
    expect(letterheadLines({ phone: "6232220000" }, LABELS)).toEqual(["(62) 3222-0000"]);
    expect(letterheadLines({ email: "contato@clinica.test" }, LABELS)).toEqual(["contato@clinica.test"]);
  });

  it("ignores a postal code that is not eight digits", () => {
    expect(letterheadLines({ postalCode: "740", city: "Goiânia" }, LABELS)).toEqual(["Goiânia"]);
  });

  it("trims what the form let through", () => {
    expect(letterheadLines({ city: "  Goiânia  ", state: " GO " }, LABELS)).toEqual(["Goiânia/GO"]);
  });
});
