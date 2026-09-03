import { credentialLines } from "./professional-credentials";
import { describe, expect, it } from "vitest";

const labels = {
  fallbackTitle: "Profissional responsável",
  registration: (value: string) => `Registro profissional ${value}`,
};

describe("what prints under the signature of an issued document", () => {
  it("names the title she practises under and her registration", () => {
    expect(
      credentialLines({ title: "Acupunturista Especialista em Medicina Chinesa", registration: "CNAA 3086" }, labels),
    ).toEqual(["Acupunturista Especialista em Medicina Chinesa", "Registro profissional CNAA 3086"]);
  });

  it("keeps the generic label when she has not filled a title — never a bare name", () => {
    expect(credentialLines({ registration: "CNAA 3086" }, labels)).toEqual([
      "Profissional responsável",
      "Registro profissional CNAA 3086",
    ]);
  });

  it("omits the registration line rather than printing an empty one", () => {
    expect(credentialLines({ title: "Acupunturista" }, labels)).toEqual(["Acupunturista"]);
    expect(credentialLines({}, labels)).toEqual(["Profissional responsável"]);
  });

  it("treats blank input as absent, so a stray space cannot print a naked number", () => {
    expect(credentialLines({ title: "   ", registration: "  " }, labels)).toEqual(["Profissional responsável"]);
  });

  it("never leaves a registration number standing alone without its label", () => {
    const lines = credentialLines({ registration: "3086" }, labels);
    expect(lines.some((line) => line === "3086")).toBe(false);
    expect(lines).toContain("Registro profissional 3086");
  });
});
