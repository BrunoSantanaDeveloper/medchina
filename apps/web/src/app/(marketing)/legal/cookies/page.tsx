import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Prose from "@/components/marketing/prose";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  return { title: t("cookies-meta-title"), alternates: { canonical: "/legal/cookies" } };
}

/**
 * Placeholder cookie policy — NOT legal advice. Replace the copy (marketing
 * namespace, cookies-* keys) with text reviewed by counsel before launch.
 */
export default async function CookiesPage() {
  const t = await getTranslations("marketing");

  return (
    <Section spacing="compact">
      <SectionHeader title={t("cookies-title")} subtitle={t("legal-updated")} align="start" className="mx-0" as="h1" />
      <Prose className="mx-0">
        {[1, 2, 3].map((index) => (
          <section key={index}>
            <h2>{t(`cookies-${index}-title`)}</h2>
            <p>{t(`cookies-${index}-body`)}</p>
          </section>
        ))}
      </Prose>
    </Section>
  );
}
