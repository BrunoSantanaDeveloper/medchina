import { buildHomeGuidance, hasHomeGuidance } from "./home-guidance";
import { describe, expect, it } from "vitest";

const fullPlan = {
  acupuncture: {
    enabled: true,
    objective: "Dispersar Fogo do Fígado",
    mainPoints: ["F3", "VB34"],
    meridians: ["Fígado"],
    strategy: "disperse",
    frequency: "1x por semana",
  },
  diet: {
    enabled: true,
    thermalNature: "morna",
    favor: ["gengibre", "aveia"],
    reduce: ["café"],
    restrictions: "Evitar álcool durante o tratamento.",
  },
  moxibustion: {
    enabled: true,
    technique: "bastão",
    pointsOrRegion: "E36",
    contraindicationChecklist: ["Verificar sensibilidade térmica", "Não aplicar sobre lesão"],
  },
  cupping: { enabled: true, region: "dorso", postSessionGuidance: "Evite banho frio nas próximas 4 horas." },
  auriculotherapy: {
    enabled: true,
    points: ["Shen Men"],
    stimulationGuidance: "Pressione 3x ao dia.",
    reassessment: "Em 7 dias",
  },
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
    const clinicalOnly = { acupuncture: { enabled: true, mainPoints: ["F3"], strategy: "tonify" } };
    expect(buildHomeGuidance(clinicalOnly)).toEqual([]);
    expect(hasHomeGuidance(clinicalOnly)).toBe(false);
    expect(hasHomeGuidance(null)).toBe(false);
    expect(hasHomeGuidance(fullPlan)).toBe(true);
  });

  it("ignores blank and malformed values instead of printing empty headings", () => {
    expect(
      buildHomeGuidance({
        cupping: { enabled: true, postSessionGuidance: "   " },
        diet: { enabled: true, favor: ["", "  "], reduce: "not a list" },
        auriculotherapy: { enabled: true, stimulationGuidance: "Pressione." },
      }),
    ).toEqual([{ label: "guidance-stimulation", text: "Pressione." }]);
  });

  it("leaves out a modality she switched off, exactly like the printed plan", () => {
    // The reported defect: a diet unticked in the plan still printed here.
    const dietOff = { ...fullPlan, diet: { ...fullPlan.diet, enabled: false } };
    const labels = buildHomeGuidance(dietOff).map((section) => section.label);
    expect(labels).not.toContain("guidance-favor");
    expect(labels).not.toContain("guidance-restrictions");
    expect(labels).toContain("guidance-frequency");

    // A modality with no switch at all is not on the printed plan either.
    expect(buildHomeGuidance({ diet: { favor: ["gengibre"] } })).toEqual([]);
    // The database also reads the string form.
    expect(buildHomeGuidance({ diet: { enabled: "true", favor: ["gengibre"] } })).toEqual([
      { label: "guidance-favor", items: ["gengibre"] },
    ]);
  });
});
