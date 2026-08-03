import { buildHomeGuidance, hasHomeGuidance } from "./home-guidance";
import { describe, expect, it } from "vitest";

const fullPlan = {
  acupuncture: {
    objective: "Dispersar Fogo do Fígado",
    mainPoints: ["F3", "VB34"],
    meridians: ["Fígado"],
    strategy: "disperse",
    frequency: "1x por semana",
  },
  diet: {
    thermalNature: "morna",
    favor: ["gengibre", "aveia"],
    reduce: ["café"],
    restrictions: "Evitar álcool durante o tratamento.",
  },
  moxibustion: {
    technique: "bastão",
    pointsOrRegion: "E36",
    contraindicationChecklist: ["Verificar sensibilidade térmica", "Não aplicar sobre lesão"],
  },
  cupping: { region: "dorso", postSessionGuidance: "Evite banho frio nas próximas 4 horas." },
  auriculotherapy: { points: ["Shen Men"], stimulationGuidance: "Pressione 3x ao dia.", reassessment: "Em 7 dias" },
};

describe("home guidance is the patient's half of the plan", () => {
  it("keeps only what she has to DO, in the order she lives it", () => {
    expect(buildHomeGuidance(fullPlan)).toEqual([
      { label: "guidance-after-session", text: "Evite banho frio nas próximas 4 horas." },
      { label: "guidance-stimulation", text: "Pressione 3x ao dia." },
      { label: "guidance-favor", items: ["gengibre", "aveia"] },
      { label: "guidance-reduce", items: ["café"] },
      { label: "guidance-restrictions", text: "Evitar álcool durante o tratamento." },
      { label: "guidance-frequency", text: "1x por semana" },
      { label: "guidance-reassessment", text: "Em 7 dias" },
    ]);
  });

  it("never leaks clinical reasoning to the patient", () => {
    const serialized = JSON.stringify(buildHomeGuidance(fullPlan));
    // Pattern, points, meridians, strategy and thermal nature are the
    // professional's reading — meaningless or alarming on a patient handout.
    for (const clinical of ["Fogo do Fígado", "VB34", "Shen Men", "Meridianos", "disperse", "morna", "E36"]) {
      expect(serialized).not.toContain(clinical);
    }
  });

  it("leaves the moxibustion safety checklist with the professional", () => {
    const serialized = JSON.stringify(buildHomeGuidance(fullPlan));
    expect(serialized).not.toContain("sensibilidade térmica");
  });

  it("reports nothing to hand over when the plan has no homework", () => {
    const clinicalOnly = { acupuncture: { mainPoints: ["F3"], strategy: "tonify" } };
    expect(buildHomeGuidance(clinicalOnly)).toEqual([]);
    expect(hasHomeGuidance(clinicalOnly)).toBe(false);
    expect(hasHomeGuidance(null)).toBe(false);
    expect(hasHomeGuidance(fullPlan)).toBe(true);
  });

  it("ignores blank and malformed values instead of printing empty headings", () => {
    expect(
      buildHomeGuidance({
        cupping: { postSessionGuidance: "   " },
        diet: { favor: ["", "  "], reduce: "not a list" },
        auriculotherapy: { stimulationGuidance: "Pressione." },
      }),
    ).toEqual([{ label: "guidance-stimulation", text: "Pressione." }]);
  });
});
