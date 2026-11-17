import { buildFbc, encodeFbclidCookie, sanitizeFbclid } from "./meta-click";
import { describe, expect, it } from "vitest";

describe("sanitizeFbclid", () => {
  it("keeps a real click id", () => {
    expect(sanitizeFbclid("IwAR0abc-DEF_123")).toBe("IwAR0abc-DEF_123");
  });

  it("trims before judging, so a URL-decoded space does not reject a valid id", () => {
    expect(sanitizeFbclid("  IwAR0abc  ")).toBe("IwAR0abc");
  });

  it("refuses anything that is not a click id", () => {
    // The value arrives in a URL anyone can write and ends up in a cookie and
    // in an outbound payload, so the shape is checked rather than trusted.
    expect(sanitizeFbclid("a.b")).toBeNull();
    expect(sanitizeFbclid("<script>")).toBeNull();
    expect(sanitizeFbclid("x".repeat(256))).toBeNull();
    expect(sanitizeFbclid("")).toBeNull();
    expect(sanitizeFbclid(null)).toBeNull();
  });
});

describe("buildFbc", () => {
  it("produces the value Meta documents, carrying the CLICK time", () => {
    const cookie = encodeFbclidCookie("IwAR0abc", 1_700_000_000_000);
    expect(buildFbc(cookie)).toBe("fb.1.1700000000000.IwAR0abc");
  });

  it("survives a click id containing the separator character", () => {
    // The id is split on the FIRST dot, so a dot inside it would be a problem —
    // Meta's ids have none, and sanitize refuses one, but the split order is
    // what makes that true rather than lucky.
    expect(buildFbc("1700000000000.has.dot")).toBeNull();
  });

  it("returns null for an absent or malformed cookie", () => {
    expect(buildFbc(null)).toBeNull();
    expect(buildFbc("")).toBeNull();
    expect(buildFbc("no-separator")).toBeNull();
    expect(buildFbc(".IwAR0abc")).toBeNull();
    expect(buildFbc("naoNumero.IwAR0abc")).toBeNull();
    expect(buildFbc("0.IwAR0abc")).toBeNull();
  });
});
