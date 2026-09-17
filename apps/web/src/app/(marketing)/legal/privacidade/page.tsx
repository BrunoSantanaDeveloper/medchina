import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Prose from "@/components/marketing/prose";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  return { title: t("privacy-meta-title"), alternates: { canonical: "/legal/privacidade" } };
}

/** Sections rendered in order; add a key pair to extend the policy. */
const SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/**
 * Privacy policy.
 *
 * The copy (marketing namespace, `privacy-*`) is the 2021 data-processing
 * annex the founder wrote for the previous product, adapted to the platform as
 * it exists today: the same controller/processor split — the professional owns
 * her patients' data, MedChina processes it on her instructions — plus the
 * vendors actually in the stack and the ad-measurement posture decided for the
 * paid campaign (server-side conversions run on legitimate interest and survive
 * a cookie refusal, because they do not depend on those cookies; see
 * `docs/TRACKING.md` and the cookie policy).
 *
 * STILL REQUIRES COUNSEL REVIEW before it is treated as final, and the
 * identification block quotes the CNPJ printed on the 2021 document — confirm
 * it is still the contracting entity.
 */
export default async function PrivacyPage() {
  const t = await getTranslations("marketing");

  return (
    <Section spacing="compact">
      <SectionHeader title={t("privacy-title")} subtitle={t("legal-updated")} align="start" className="mx-0" as="h1" />
      <Prose className="mx-0">
        {SECTIONS.map((index) => (
          <section key={index}>
            <h2>{t(`privacy-${index}-title`)}</h2>
            <p>{t(`privacy-${index}-body`)}</p>
          </section>
        ))}
      </Prose>
    </Section>
  );
}
