import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Prose from "@/components/marketing/prose";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import { getGuaranteeDays } from "@/lib/guarantee";

export async function generateMetadata(): Promise<Metadata> {
  const [t, days] = await Promise.all([getTranslations("marketing"), getGuaranteeDays()]);
  return {
    title: t("guarantee-meta-title", { days }),
    description: t("guarantee-meta-description", { days }),
    alternates: { canonical: "/legal/garantia" },
  };
}

/**
 * The money-back guarantee, on its own URL.
 *
 * It exists as a page — not a line of small print next to a price — because the
 * offer pages point at it: a risk-reversal promise a buyer cannot open and read
 * in full is not risk reversal (docs/FUNIL.md T1.5, T3.1).
 *
 * The clause that matters most here is the clinical one. The objection to a
 * refund in this product is never "will I get my money back", it is "do I lose
 * my patients' records if I leave" — so that answer is stated plainly, and it is
 * TRUE by construction: the chart stays readable when a plan ends (only new
 * capture stops, migration 0024) and the account export carries no plan gate
 * (migration 0081).
 *
 * The day count comes from `getGuaranteeDays()` so the page and the future
 * refund window cannot drift apart. COMMERCIAL COMMITMENT, reviewed by counsel
 * like the other pages under /legal: the wording is approved, and changing the
 * promise is a legal decision, not a copy edit. The NUMBER is the exception —
 * it is `platform_settings.guarantee` and is meant to be changed there.
 */
export default async function GuaranteePage() {
  const [t, days] = await Promise.all([getTranslations("marketing"), getGuaranteeDays()]);

  return (
    <Section spacing="compact">
      <SectionHeader
        title={t("guarantee-title", { days })}
        subtitle={t("guarantee-subtitle", { days })}
        align="start"
        className="mx-0"
        as="h1"
      />
      <Prose className="mx-0">
        {/* Written out rather than mapped over an index: the keys stay
            type-checked, and only the clause that quotes the window takes the
            day count — a loop would have to erase both. */}
        <section>
          <h2>{t("guarantee-1-title")}</h2>
          <p>{t("guarantee-1-body", { days })}</p>
        </section>
        <section>
          <h2>{t("guarantee-2-title")}</h2>
          <p>{t("guarantee-2-body")}</p>
        </section>
        <section>
          <h2>{t("guarantee-3-title")}</h2>
          <p>{t("guarantee-3-body")}</p>
        </section>
        <section>
          <h2>{t("guarantee-4-title")}</h2>
          <p>{t("guarantee-4-body")}</p>
        </section>
        <section>
          <h2>{t("guarantee-5-title")}</h2>
          <p>{t("guarantee-5-body")}</p>
        </section>
        <p className="text-text-secondary text-sm">{t("legal-updated")}</p>
      </Prose>
    </Section>
  );
}
