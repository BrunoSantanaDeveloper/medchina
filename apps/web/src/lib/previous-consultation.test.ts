import {
  compareAnswer,
  type HistoryRow,
  IMPORTED_HISTORY_LIMIT,
  pickImportedHistory,
  type PreviousConsultation,
  summarizeChanges,
} from "./previous-consultation";
import { describe, expect, it } from "vitest";

const previous: PreviousConsultation = {
  id: "prev",
  when: "2026-06-01T10:00:00Z",
  chiefComplaint: "Insônia",
  summary: null,
  legacyBody: null,
  importedHistory: [],
  answers: {
    "sleep.quality": { key: "sleep.quality", value: "Acorda 3x por noite", source: "ai" },
    "complaint.intensity": { key: "complaint.intensity", value: "8", source: "professional" },
    "tcm.pulse": { key: "tcm.pulse", value: "Fino e em corda", source: "professional_voice" },
  },
  patterns: ["Deficiência de Qi do Baço"],
  gaps: [],
};

describe("comparing a return consultation with the previous one", () => {
  it("names each kind of difference", () => {
    expect(compareAnswer("Acorda 1x por noite", "Acorda 3x por noite")).toBe("changed");
    expect(compareAnswer("Acorda 3x por noite", "Acorda 3x por noite")).toBe("same");
    expect(compareAnswer("Dor no ombro", undefined)).toBe("new");
  });

  it("treats a blank field as still-to-ask, never as a negative (PRD §10.5)", () => {
    // Recorded last time, empty now: the patient did not say it stopped — the
    // question simply has not been asked yet in this consultation.
    expect(compareAnswer(undefined, "Fino e em corda")).toBe("missing");
    expect(compareAnswer("   ", "Fino e em corda")).toBe("missing");
    // Never recorded on either side is not a difference to report.
    expect(compareAnswer(undefined, undefined)).toBe("same");
  });

  it("ignores whitespace-only edits so a stray space is not a clinical change", () => {
    expect(compareAnswer("  Acorda 3x por noite  ", "Acorda 3x por noite")).toBe("same");
  });

  it("summarizes the differences over the declared fields only", () => {
    const summary = summarizeChanges(
      {
        "sleep.quality": "Acorda 1x por noite", // changed
        "complaint.intensity": "8", // same
        "energy.level": "Melhor pela manhã", // new
        // tcm.pulse absent → missing
      },
      previous,
      ["sleep.quality", "complaint.intensity", "energy.level", "tcm.pulse"],
    );
    expect(summary).toEqual({ changed: 1, new: 1, missing: 1 });
  });

  it("reports nothing for a first consultation", () => {
    expect(summarizeChanges({ "sleep.quality": "Dorme bem" }, null, ["sleep.quality"])).toEqual({
      changed: 0,
      new: 0,
      missing: 0,
    });
  });
});

const row = (id: string, legacyBody: string | null, startedAt = "2023-08-16T13:00:00Z"): HistoryRow => ({
  id,
  started_at: startedAt,
  scheduled_for: null,
  created_at: "2026-09-04T12:00:00Z",
  legacy_body: legacyBody,
  legacy_source: legacyBody ? "Sistema anterior" : null,
});

describe("imported history beside a return consultation", () => {
  it("shows the imported records when the last consultation came from another system", () => {
    // The screenshot case: several visits imported on the same day, no answers.
    const records = pickImportedHistory(
      [row("a", "C7d, IG11e, F3e, E36d stiper"), row("b", "C7d, PC6d, F3e LASER 4J - V"), row("c", "E36e, BA6d")],
      false,
    );
    expect(records.map((record) => record.id)).toEqual(["a", "b", "c"]);
    expect(records[0]).toMatchObject({
      excerpt: "C7d, IG11e, F3e, E36d stiper",
      when: "2023-08-16T13:00:00Z",
      source: "Sistema anterior",
    });
  });

  it("shows nothing when the last consultation was written here", () => {
    expect(pickImportedHistory([row("a", null), row("b", "C7d")], false)).toEqual([]);
    // Answers win even if a legacy text exists: the field comparison is the better view.
    expect(pickImportedHistory([row("a", "C7d")], true)).toEqual([]);
  });

  it("stops at the first consultation written here and at the limit", () => {
    expect(pickImportedHistory([row("a", "C7d"), row("b", null), row("c", "E36e")], false)).toHaveLength(1);
    const many = Array.from({ length: IMPORTED_HISTORY_LIMIT + 2 }, (_, i) => row(`r${i}`, `registro ${i}`));
    expect(pickImportedHistory(many, false)).toHaveLength(IMPORTED_HISTORY_LIMIT);
  });

  it("keeps a long imported text short and never empty", () => {
    const [record] = pickImportedHistory([row("a", `  ${"x".repeat(1000)}  `)], false);
    expect(record.excerpt.length).toBeLessThanOrEqual(281);
    expect(record.excerpt.endsWith("…")).toBe(true);
    expect(pickImportedHistory([row("a", "   ")], false)).toEqual([]);
  });
});
