import {
  insertWhatsappToken,
  normalizeWhatsappTemplate,
  renderWhatsappTemplate,
  unknownWhatsappTokens,
  WHATSAPP_TEMPLATE_MAX,
} from "./whatsapp-template";
import { describe, expect, it } from "vitest";

const VALUES = { name: "Ana", date: "14/10", time: "09:00" };

describe("renderWhatsappTemplate", () => {
  it("fills every known token, repeats included", () => {
    expect(renderWhatsappTemplate("Olá, {name}! Dia {date} às {time}. Até lá, {name}.", VALUES)).toBe(
      "Olá, Ana! Dia 14/10 às 09:00. Até lá, Ana.",
    );
  });

  it("leaves an unknown placeholder intact instead of throwing or blanking it", () => {
    // The whole point: free text she typed must never break the run, and a
    // silent empty string would ship a half-written sentence to a patient.
    expect(renderWhatsappTemplate("Oi {name}, {clinica} te espera", VALUES)).toBe("Oi Ana, {clinica} te espera");
  });

  it("passes a template with no token through untouched", () => {
    expect(renderWhatsappTemplate("Lembrete da sua consulta.", VALUES)).toBe("Lembrete da sua consulta.");
  });
});

describe("normalizeWhatsappTemplate", () => {
  it("treats blank and whitespace as 'use the default', not as an empty message", () => {
    expect(normalizeWhatsappTemplate("")).toBeNull();
    expect(normalizeWhatsappTemplate("   \n ")).toBeNull();
    expect(normalizeWhatsappTemplate(null)).toBeNull();
    expect(normalizeWhatsappTemplate(undefined)).toBeNull();
  });

  it("trims and caps at the stored maximum", () => {
    expect(normalizeWhatsappTemplate("  oi  ")).toBe("oi");
    expect(normalizeWhatsappTemplate("a".repeat(WHATSAPP_TEMPLATE_MAX + 50))).toHaveLength(WHATSAPP_TEMPLATE_MAX);
  });
});

describe("unknownWhatsappTokens", () => {
  it("reports each unfillable placeholder once, in order", () => {
    expect(unknownWhatsappTokens("{name} {clinica} {date} {clinica} {endereco}")).toEqual(["clinica", "endereco"]);
  });

  it("stays silent when every placeholder is fillable", () => {
    expect(unknownWhatsappTokens("{name} {date} {time}")).toEqual([]);
  });
});

describe("insertWhatsappToken", () => {
  it("inserts at the caret and reports where the caret lands", () => {
    const result = insertWhatsappToken("Olá, !", "name", 5, 5);

    expect(result.text).toBe("Olá, {name}!");
    expect(result.caret).toBe(11);
  });

  it("replaces the selection rather than duplicating it", () => {
    expect(insertWhatsappToken("Olá, XXX!", "name", 5, 8).text).toBe("Olá, {name}!");
  });

  it("clamps a caret past the end instead of producing undefined text", () => {
    expect(insertWhatsappToken("oi", "date", 99, 99).text).toBe("oi{date}");
  });
});
