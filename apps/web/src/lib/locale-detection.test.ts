import { detectLocale, isCrawler, localeFromAcceptLanguage, localeFromCountry } from "./locale-detection";
import { describe, expect, it } from "vitest";

const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("localeFromAcceptLanguage", () => {
  it("matches an exact tag we ship", () => {
    expect(localeFromAcceptLanguage("zh-CN,zh;q=0.9")).toBe("zh-CN");
    expect(localeFromAcceptLanguage("pt-BR,pt;q=0.9,en;q=0.8")).toBe("pt-BR");
  });

  it("falls back to the primary subtag", () => {
    expect(localeFromAcceptLanguage("en-GB")).toBe("en");
    expect(localeFromAcceptLanguage("pt-PT")).toBe("pt-BR");
  });

  it("maps every Han variant to the one catalog we ship", () => {
    // Traditional-script readers get Simplified, not Portuguese.
    expect(localeFromAcceptLanguage("zh-TW")).toBe("zh-CN");
    expect(localeFromAcceptLanguage("zh-Hant-HK")).toBe("zh-CN");
  });

  it("honours quality values over header order", () => {
    expect(localeFromAcceptLanguage("de;q=0.2,zh-CN;q=0.9")).toBe("zh-CN");
  });

  it("keeps the more specific tag when two map to the same language", () => {
    expect(localeFromAcceptLanguage("pt-BR,pt;q=0.9")).toBe("pt-BR");
  });

  it("skips languages we do not ship", () => {
    expect(localeFromAcceptLanguage("ja,ko;q=0.9,fr;q=0.5")).toBe("fr");
    expect(localeFromAcceptLanguage("ja,ko;q=0.9")).toBeNull();
  });

  it("ignores q=0 and the wildcard", () => {
    expect(localeFromAcceptLanguage("zh-CN;q=0,*")).toBeNull();
  });

  it("returns null for nothing at all", () => {
    expect(localeFromAcceptLanguage(null)).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
  });
});

describe("localeFromCountry", () => {
  it("maps the Chinese-speaking regions", () => {
    expect(localeFromCountry("CN")).toBe("zh-CN");
    expect(localeFromCountry("tw")).toBe("zh-CN");
  });

  it("returns null for a country with no language we ship", () => {
    expect(localeFromCountry("JP")).toBeNull();
    expect(localeFromCountry(null)).toBeNull();
  });
});

describe("isCrawler", () => {
  it("recognizes the crawlers that matter here", () => {
    expect(isCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isCrawler("Mozilla/5.0 (compatible; Baiduspider/2.0)")).toBe(true);
    expect(isCrawler("WhatsApp/2.23")).toBe(true);
  });

  it("treats a missing user agent as a script", () => {
    expect(isCrawler(null)).toBe(true);
  });

  it("lets a real browser through", () => {
    expect(isCrawler(BROWSER)).toBe(false);
  });
});

describe("detectLocale", () => {
  it("switches a Chinese-speaking visitor", () => {
    expect(detectLocale({ acceptLanguage: "zh-CN,zh;q=0.9", userAgent: BROWSER })).toBe("zh-CN");
  });

  it("returns null when the visitor already reads the default language", () => {
    // Nothing to persist and, above all, nothing to announce.
    expect(detectLocale({ acceptLanguage: "pt-BR", country: "BR", userAgent: BROWSER })).toBeNull();
  });

  it("never switches a crawler — only pt-BR is indexable", () => {
    expect(
      detectLocale({
        acceptLanguage: "zh-CN",
        country: "CN",
        userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      }),
    ).toBeNull();
  });

  it("lets the header beat the country", () => {
    // A Brazilian at a congress in Shanghai keeps Portuguese.
    expect(detectLocale({ acceptLanguage: "pt-BR,pt;q=0.9", country: "CN", userAgent: BROWSER })).toBeNull();
  });

  it("uses the country only when the header says nothing we ship", () => {
    expect(detectLocale({ acceptLanguage: "ja", country: "CN", userAgent: BROWSER })).toBe("zh-CN");
    expect(detectLocale({ acceptLanguage: null, country: "CN", userAgent: BROWSER })).toBe("zh-CN");
  });

  it("leaves the default alone when there is no signal", () => {
    expect(detectLocale({ userAgent: BROWSER })).toBeNull();
  });
});
