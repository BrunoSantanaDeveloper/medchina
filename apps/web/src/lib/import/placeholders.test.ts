import { isPlaceholderCell, readCell } from "./placeholders";
import { describe, expect, it } from "vitest";

describe("cells that say nothing", () => {
  it("reads the absences an old system writes as absence", () => {
    // The reported case: "Observações: NULL" on an imported chart.
    expect(readCell("NULL")).toBe("");
    for (const written of ["null", " N/A ", "n.a.", "#N/A", "--", "—", "...", "?", "Não informado", "sem dados"]) {
      expect(isPlaceholderCell(written), written).toBe(true);
    }
  });

  it("never swallows content", () => {
    for (const real of ["Nenhuma", "N/A de rotina", "na", "nd", "x", "0", "não usa medicação", "-5 kg"]) {
      expect(isPlaceholderCell(real), real).toBe(false);
    }
    expect(readCell("  Dorme mal  ")).toBe("Dorme mal");
  });

  it("keeps an empty cell empty and nothing undefined", () => {
    // Empty is not a placeholder — there is no absence written down to read.
    expect(isPlaceholderCell("")).toBe(false);
    expect(isPlaceholderCell("   ")).toBe(false);
    expect(readCell(undefined)).toBe("");
    expect(readCell("   ")).toBe("");
  });
});
