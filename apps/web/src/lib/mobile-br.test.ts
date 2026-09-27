import { describe, expect, it } from "vitest";

import { formatMobileBrInput, normalizeMobileBr } from "@flyee/fields";

describe("normalizeMobileBr", () => {
  it("accepts a masked mobile and returns bare digits", () => {
    expect(normalizeMobileBr("(62) 99999-1234")).toEqual({ ok: true, digits: "62999991234" });
  });

  it("strips the country code WhatsApp copies", () => {
    expect(normalizeMobileBr("+55 62 99999-1234")).toEqual({ ok: true, digits: "62999991234" });
  });

  it("strips a trunk zero", () => {
    expect(normalizeMobileBr("062999991234")).toEqual({ ok: true, digits: "62999991234" });
  });

  it("keeps DDD 55 (Rio Grande do Sul) — it is an area code, not the country", () => {
    expect(normalizeMobileBr("(55) 99999-1234")).toEqual({ ok: true, digits: "55999991234" });
  });

  it("refuses a landline, which cannot receive WhatsApp", () => {
    expect(normalizeMobileBr("(62) 3333-4444")).toEqual({ ok: false, reason: "landline" });
  });

  it("reads a mobile without the leading 9 as a missing digit, not a landline", () => {
    expect(normalizeMobileBr("(62) 9999-1234")).toEqual({ ok: false, reason: "short" });
  });

  it("names the other failures", () => {
    expect(normalizeMobileBr("")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeMobileBr("62 9999")).toEqual({ ok: false, reason: "short" });
    expect(normalizeMobileBr("62 99999 12345")).toEqual({ ok: false, reason: "long" });
    expect(normalizeMobileBr("(62) 89999-1234")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("formatMobileBrInput", () => {
  it("masks a pasted international number as a local one", () => {
    expect(formatMobileBrInput("+55 62 99999-1234")).toBe("(62) 99999-1234");
  });
});
