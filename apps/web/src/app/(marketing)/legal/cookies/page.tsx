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
 * Cookie policy.
 *
 * Section 4 is the one that has to stay true: the browser trackers stop when a
 * visitor refuses, and the server-side conversions do NOT, because they never
 * depended on those cookies. That posture was chosen deliberately (the page and
 * the banner say so, and the privacy policy names the legal basis) — so a
 * change to `lib/meta-capi.ts` or `lib/ga4-mp.ts` that starts or stops honouring
 * the refusal has to change this copy in the same commit.
 *
 * Reviewed by counsel; this text is the approved wording. Any edit beyond a
 * typo is a new legal review, not a copy change.
 */
export default async function CookiesPage() {
  const t = await getTranslations("marketing");

  return (
    <Section spacing="compact">
      <SectionHeader title={t("cookies-title")} subtitle={t("legal-updated")} align="start" className="mx-0" as="h1" />
      <Prose className="mx-0">
        {[1, 2, 3, 4, 5].map((index) => (
          <section key={index}>
            <h2>{t(`cookies-${index}-title`)}</h2>
            <p>{t(`cookies-${index}-body`)}</p>
          </section>
        ))}
      </Prose>
    </Section>
  );
}
