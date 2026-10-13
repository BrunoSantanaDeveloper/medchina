import { describe, expect, it } from "vitest";

import {
  cleanOtherModality,
  matchPracticeModality,
  normalizeOtherModalities,
  otherModalityIssue,
  type PracticeModality,
  proposeTimezone,
  sameClock,
  utcOffsetMinutes,
} from "@/lib/practice-context";

const LABELS: Record<PracticeModality, string> = {
  acupuncture: "Acupuntura",
  diet: "Dietoterapia chinesa",
  moxibustion: "Moxabustão",
  auriculotherapy: "Auriculoterapia",
  cupping: "Ventosaterapia",
};

/** A fixed instant, so the offset assertions do not depend on the day the suite runs. */
const NOW = new Date("2026-10-12T15:00:00Z");

describe("modalities beyond the five", () => {
  // The same input and the same answer as packages/db/tests/0047: the client
  // and `normalize_practice_modalities_other` must never disagree about what
  // she declared.
  it("normalises exactly like the database", () => {
    expect(
      normalizeOtherModalities(["  Tui   Na ", "tui na", "ACUPUNCTURE", "", null, "Shiatsu\n", "Shiatsu"]),
    ).toEqual(["Tui Na", "Shiatsu"]);
  });

  it("turns control characters and runs of whitespace into one space", () => {
    expect(cleanOtherModality("  Tui\t\tNa\u0000 ")).toBe("Tui Na");
  });

  it("refuses a label a spreadsheet would read as a formula", () => {
    for (const value of ['=HYPERLINK("x")', "+55 11", "@tuina", "-shiatsu"]) {
      expect(otherModalityIssue(value)).toBe("leading_symbol");
    }
  });

  it("keeps a label between 2 and 60 characters", () => {
    expect(otherModalityIssue("x")).toBe("too_short");
    expect(otherModalityIssue("a".repeat(61))).toBe("too_long");
    expect(otherModalityIssue("a".repeat(60))).toBeNull();
    // Counted in characters, like char_length — not in UTF-16 units.
    expect(otherModalityIssue("推拿")).toBeNull();
  });

  it("recognises a known modality however it is typed", () => {
    expect(matchPracticeModality("acupuntura", LABELS)).toBe("acupuncture");
    expect(matchPracticeModality("  MOXABUSTAO ", LABELS)).toBe("moxibustion");
    expect(matchPracticeModality("cupping", LABELS)).toBe("cupping");
    expect(matchPracticeModality("Tui Na", LABELS)).toBeNull();
    expect(matchPracticeModality("   ", LABELS)).toBeNull();
  });
});

describe("the practice timezone without a field of its own", () => {
  it("reads a zone's offset", () => {
    expect(utcOffsetMinutes("America/Sao_Paulo", NOW)).toBe(-180);
    expect(utcOffsetMinutes("America/Manaus", NOW)).toBe(-240);
    expect(utcOffsetMinutes("Marte/Olympus", NOW)).toBeNull();
  });

  it("tells the same clock under another name from a different clock", () => {
    expect(sameClock("America/Recife", "America/Sao_Paulo", NOW)).toBe(true);
    expect(sameClock("America/Manaus", "America/Sao_Paulo", NOW)).toBe(false);
    // Agrees for part of the year only — which is not the same clock.
    expect(sameClock("America/New_York", "America/Bogota", new Date("2026-01-15T15:00:00Z"))).toBe(false);
  });

  it("never asks again once the timezone was confirmed", () => {
    expect(
      proposeTimezone({ stored: "America/Sao_Paulo", confirmed: true, browser: "Europe/Lisbon", now: NOW }),
    ).toEqual({ kind: "kept", timezone: "America/Sao_Paulo" });
  });

  it("confirms in silence when the browser agrees with the stored clock", () => {
    expect(
      proposeTimezone({ stored: "America/Sao_Paulo", confirmed: false, browser: "America/Sao_Paulo", now: NOW }),
    ).toEqual({ kind: "silent", timezone: "America/Sao_Paulo", source: "browser" });
    // Same clock, more precise name: the browser's zone is the one kept.
    expect(
      proposeTimezone({ stored: "America/Sao_Paulo", confirmed: false, browser: "America/Recife", now: NOW }),
    ).toEqual({ kind: "silent", timezone: "America/Recife", source: "browser" });
  });

  it("falls back to the stored zone when the browser offers nothing usable", () => {
    for (const browser of [null, undefined, "", "Marte/Olympus"]) {
      expect(proposeTimezone({ stored: "America/Sao_Paulo", confirmed: false, browser, now: NOW })).toEqual({
        kind: "silent",
        timezone: "America/Sao_Paulo",
        source: "default",
      });
    }
  });

  it("asks only when the clocks differ — a silently wrong zone moves every appointment", () => {
    expect(
      proposeTimezone({ stored: "America/Sao_Paulo", confirmed: false, browser: "America/Manaus", now: NOW }),
    ).toEqual({ kind: "ask", browser: "America/Manaus", stored: "America/Sao_Paulo" });
  });
});
