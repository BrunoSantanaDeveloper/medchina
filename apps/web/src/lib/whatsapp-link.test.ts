import { whatsappDeepLink } from "./whatsapp-link";
import { describe, expect, it } from "vitest";

describe("WhatsApp handoff links", () => {
  it("prefixes the Brazilian country code on a bare mobile", () => {
    expect(whatsappDeepLink("11987654321", "Olá!")).toBe("https://wa.me/5511987654321?text=Ol%C3%A1!");
  });

  it("passes through a number already carrying the country code", () => {
    expect(whatsappDeepLink("5511987654321", "oi")).toBe("https://wa.me/5511987654321?text=oi");
  });

  it("returns null for a phone that cannot be reached, so the UI offers the link instead", () => {
    expect(whatsappDeepLink(null, "oi")).toBeNull();
    expect(whatsappDeepLink("", "oi")).toBeNull();
    expect(whatsappDeepLink("123", "oi")).toBeNull();
    // 12 digits not starting with 55 cannot be a BR number with country code.
    expect(whatsappDeepLink("441132654321", "oi")).toBeNull();
  });

  it("escapes the message so a document URL survives the query string intact", () => {
    const url = "https://app.medchina.com.br/documento#abc-DEF_123";
    const link = whatsappDeepLink("11987654321", `Segue: ${url}`);
    // The fragment must be encoded — a raw # would truncate the wa.me text.
    expect(link).toContain("%23abc-DEF_123");
    expect(link).not.toContain("#abc");
  });
});
