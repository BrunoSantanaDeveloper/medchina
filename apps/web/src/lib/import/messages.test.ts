import { describe, expect, it } from "vitest";

import de from "@flyee/content/messages/de.json";
import en from "@flyee/content/messages/en.json";
import es from "@flyee/content/messages/es.json";
import fr from "@flyee/content/messages/fr.json";
import ptBR from "@flyee/content/messages/pt-BR.json";
import zhCN from "@flyee/content/messages/zh-CN.json";

/**
 * The six catalogs must hold the SAME keys.
 *
 * There is no `getMessageFallback` configured, so a key present in pt-BR and
 * missing in another locale does not fail the build or the page: it prints the
 * key path on screen, to someone who is already stuck. Import strings are
 * written by hand across six files, which is exactly the kind of edit that
 * drifts.
 */

const CATALOGS: Record<string, Record<string, Record<string, string>>> = {
  "pt-BR": ptBR,
  en,
  es,
  fr,
  de,
  "zh-CN": zhCN,
};

const NAMESPACES = ["product", "auth", "dashboard", "marketing"];

describe("message catalogs", () => {
  const reference = CATALOGS["pt-BR"];

  it.each(NAMESPACES)("%s has the same keys in every locale", (namespace) => {
    const expected = Object.keys(reference[namespace] ?? {}).sort();

    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "pt-BR") continue;
      const actual = Object.keys(catalog[namespace] ?? {}).sort();
      const missing = expected.filter((key) => !actual.includes(key));
      const extra = actual.filter((key) => !expected.includes(key));

      expect({ locale, missing, extra }).toEqual({ locale, missing: [], extra: [] });
    }
  });

  it("never ships an empty string as a translation", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const namespace of NAMESPACES) {
        const blank = Object.entries(catalog[namespace] ?? {})
          .filter(([, value]) => typeof value === "string" && value.trim() === "")
          .map(([key]) => key);
        expect({ locale, namespace, blank }).toEqual({ locale, namespace, blank: [] });
      }
    }
  });

  it("keeps the same ICU placeholders in every locale", () => {
    // A dropped {count} is invisible until the sentence renders without the
    // number that made it a sentence.
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)].map((match) => match[1]).sort();

    for (const namespace of NAMESPACES) {
      for (const [key, value] of Object.entries(reference[namespace] ?? {})) {
        if (typeof value !== "string") continue;
        const expected = [...new Set(placeholders(value))];
        if (expected.length === 0) continue;

        for (const [locale, catalog] of Object.entries(CATALOGS)) {
          if (locale === "pt-BR") continue;
          const translated = catalog[namespace]?.[key];
          if (typeof translated !== "string") continue;
          expect({ locale, key, names: [...new Set(placeholders(translated))] }).toEqual({
            locale,
            key,
            names: expected,
          });
        }
      }
    }
  });
});
