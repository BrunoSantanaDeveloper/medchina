import { renderWhatsappTemplate } from "./whatsapp-template";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "@flyee/content/messages/pt-BR.json";

/**
 * The reminder editor shows the product default as EDITABLE TEXT, and gets it
 * by feeding the ICU message its own token names as values:
 *
 *   t("reminders-message", { name: "{name}", date: "{date}", time: "{time}" })
 *
 * That trick is load-bearing — it is what keeps one copy of the sentence in the
 * catalogs instead of two, and what makes "restore the default" produce a
 * localized template rather than a frozen snapshot. It only works because ICU
 * inserts argument VALUES literally and never re-parses them, so these tests
 * pin that behaviour against a next-intl upgrade that might change it.
 */
describe("the default reminder template", () => {
  const t = createTranslator({ locale: "pt-BR", messages, namespace: "product" });

  it("renders the ICU message back into a raw template with its tokens intact", () => {
    const template = t("reminders-message", { name: "{name}", date: "{date}", time: "{time}" });

    expect(template).toContain("{name}");
    expect(template).toContain("{date}");
    expect(template).toContain("{time}");
    // The braces survive as literal text, not as a parsed placeholder.
    expect(template).not.toContain("undefined");
  });

  it("round-trips: the raw template fills back to the same sentence ICU produces", () => {
    const values = { name: "Ana", date: "14/10", time: "09:00" };
    const template = t("reminders-message", { name: "{name}", date: "{date}", time: "{time}" });

    expect(renderWhatsappTemplate(template, values)).toBe(t("reminders-message", values));
  });
});
