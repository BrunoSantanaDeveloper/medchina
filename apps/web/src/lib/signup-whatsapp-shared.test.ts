import {
  brLocalDigits,
  extractSignupCodes,
  formatSignupWhatsAppInput,
  normalizeWhatsAppSender,
  parseSignupWhatsApp,
} from "./signup-whatsapp-shared";
import { describe, expect, it } from "vitest";

describe("parseSignupWhatsApp", () => {
  it("stores a Brazilian mobile with the country code, however it was written", () => {
    expect(parseSignupWhatsApp("(11) 98888-7777")).toEqual({ ok: true, digits: "5511988887777" });
    expect(parseSignupWhatsApp("11988887777")).toEqual({ ok: true, digits: "5511988887777" });
    // What WhatsApp itself copies to the clipboard.
    expect(parseSignupWhatsApp("+55 11 98888-7777")).toEqual({ ok: true, digits: "5511988887777" });
  });

  it("says why a Brazilian number is not a WhatsApp number", () => {
    expect(parseSignupWhatsApp("")).toEqual({ ok: false, reason: "empty" });
    expect(parseSignupWhatsApp("(11) 3333-4444")).toEqual({ ok: false, reason: "landline" });
    // A mobile written the pre-2016 way: one digit is missing, it is not a landline.
    expect(parseSignupWhatsApp("(11) 8888-7777")).toEqual({ ok: false, reason: "short" });
    expect(parseSignupWhatsApp("1198888")).toEqual({ ok: false, reason: "short" });
  });

  it("takes a number from another country as typed, when it says so with +", () => {
    expect(parseSignupWhatsApp("+86 138 0013 8000")).toEqual({ ok: true, digits: "8613800138000" });
    expect(parseSignupWhatsApp("+351 912 345 678")).toEqual({ ok: true, digits: "351912345678" });
    expect(parseSignupWhatsApp("+1 23")).toEqual({ ok: false, reason: "invalid" });
  });

  it("does not let + smuggle a Brazilian landline past the mobile rule", () => {
    expect(parseSignupWhatsApp("+55 11 3333-4444")).toEqual({ ok: false, reason: "landline" });
  });
});

describe("formatSignupWhatsAppInput", () => {
  it("masks a Brazilian number as she types", () => {
    expect(formatSignupWhatsAppInput("11988887777")).toBe("(11) 98888-7777");
  });

  it("leaves a number that starts with + alone, minus what is not a phone character", () => {
    expect(formatSignupWhatsAppInput("+86 138abc0013")).toBe("+86 1380013");
  });
});

describe("brLocalDigits", () => {
  it("gives a Brazilian number back without the country code", () => {
    expect(brLocalDigits("5511988887777")).toBe("11988887777");
  });

  it("answers null for a number that is not Brazilian, or for nothing", () => {
    expect(brLocalDigits("8613800138000")).toBeNull();
    expect(brLocalDigits(null)).toBeNull();
  });
});

describe("extractSignupCodes", () => {
  it("finds the code in the prefilled sentence", () => {
    expect(extractSignupCodes("Quero confirmar meu cadastro no MedChina. Código: 7K4Q9P")).toContain("7K4Q9P");
  });

  it("does not glue an accented word to its neighbour", () => {
    // "Código" must not turn into a candidate built from "DIGO" + something.
    expect(extractSignupCodes("Código 7K4Q9P")).toEqual(["7K4Q9P"]);
  });

  it("accepts a code she retyped in lower case", () => {
    expect(extractSignupCodes("meu código é 7k4q9p")).toContain("7K4Q9P");
  });

  it("keeps every code-shaped word, so the database decides", () => {
    expect(extractSignupCodes("Confirm my sign-up NUMBER 7K4Q9P")).toEqual(["NUMBER", "7K4Q9P"]);
  });

  it("ignores symbols outside the alphabet and words of other lengths", () => {
    expect(extractSignupCodes("ABCDE1 ABCDEO 7K4Q9PX oi")).toEqual([]);
  });

  it("returns nothing for an empty message", () => {
    expect(extractSignupCodes(undefined)).toEqual([]);
    expect(extractSignupCodes("")).toEqual([]);
  });
});

describe("normalizeWhatsAppSender", () => {
  it("passes a full Brazilian mobile through", () => {
    expect(normalizeWhatsAppSender("5511988887777")).toBe("5511988887777");
  });

  it("puts back the ninth digit WhatsApp drops from older Brazilian mobiles", () => {
    expect(normalizeWhatsAppSender("551188887777")).toBe("5511988887777");
  });

  it("leaves a Brazilian landline (starts 2-5) alone", () => {
    expect(normalizeWhatsAppSender("551133334444")).toBe("551133334444");
  });

  it("keeps numbers from other countries as they are", () => {
    expect(normalizeWhatsAppSender("+86 138 0013 8000")).toBe("8613800138000");
  });

  it("refuses what cannot be a phone number", () => {
    expect(normalizeWhatsAppSender("123")).toBeNull();
    expect(normalizeWhatsAppSender("0011988887777")).toBeNull();
    expect(normalizeWhatsAppSender(null)).toBeNull();
  });
});
