import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import AnamnesisCard from "@/components/marketing/anamnesis-card";
import Cta from "@/components/marketing/cta";
import FeatureGrid from "@/components/marketing/feature-grid";
import FeatureRows from "@/components/marketing/feature-row";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import NiAi from "@/icons/nexture/ni-ai";
import NiArrowHistory from "@/icons/nexture/ni-arrow-history";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import NiLock from "@/icons/nexture/ni-lock";
import NiMicrophone from "@/icons/nexture/ni-microphone";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  return {
    title: t("sec-meta-title"),
    description: t("sec-meta-description"),
    alternates: { canonical: "/seguranca" },
  };
}

/**
 * /seguranca — trust depth (HOME-SPEC §22/§28): the five control pillars,
 * then how consent and the record's history actually behave. Careful language
 * only (privacy-by-design, never "100% compliant") — see docs/DESIGN.md copy
 * guardrails.
 */
export default async function SecurityPage() {
  const t = await getTranslations("marketing");

  return (
    <>
      <Section decor="glow" spacing="compact">
        <SectionHeader
          as="h1"
          eyebrow={t("security-eyebrow")}
          title={t("security-title")}
          subtitle={t("security-subtitle")}
        />
      </Section>

      <FeatureGrid
        title={t("sec-pillars-title")}
        features={[
          {
            icon: <NiClipboard size="large" />,
            title: t("security-1-title"),
            description: t("security-1-body"),
            tone: "accent-1",
          },
          {
            icon: <NiMicrophone size="large" />,
            title: t("security-2-title"),
            description: t("security-2-body"),
            tone: "accent-3",
          },
          {
            icon: <NiLock size="large" />,
            title: t("security-3-title"),
            description: t("security-3-body"),
            tone: "accent-2",
          },
          {
            icon: <NiArrowHistory size="large" />,
            title: t("security-4-title"),
            description: t("security-4-body"),
            tone: "secondary",
          },
          {
            icon: <NiAi size="large" />,
            title: t("security-5-title"),
            description: t("security-5-body"),
            tone: "accent-4",
          },
        ]}
      />

      <FeatureRows
        decor="gradient-edge"
        eyebrow={t("sec-rows-eyebrow")}
        title={t("sec-rows-title")}
        items={[
          {
            eyebrow: t("sec-row-1-eyebrow"),
            title: t("sec-row-1-title"),
            body: t("sec-row-1-body"),
            bullets: [t("sec-row-1-bullet-1"), t("sec-row-1-bullet-2"), t("sec-row-1-bullet-3")],
            media: (
              <AnamnesisCard
                title={t("consent-title")}
                subtitle={t("consent-subtitle")}
                fields={[
                  {
                    label: t("consent-f1-label"),
                    value: t("consent-f1-value"),
                    state: "clear",
                    stateLabel: t("consent-granted"),
                  },
                  {
                    label: t("consent-f2-label"),
                    value: t("consent-f2-value"),
                    state: "clear",
                    stateLabel: t("consent-granted"),
                  },
                  { label: t("consent-f3-label"), state: "empty", stateLabel: t("consent-not-granted") },
                ]}
              />
            ),
            tone: "accent-1",
          },
          {
            eyebrow: t("sec-row-2-eyebrow"),
            title: t("sec-row-2-title"),
            body: t("sec-row-2-body"),
            bullets: [t("sec-row-2-bullet-1"), t("sec-row-2-bullet-2"), t("sec-row-2-bullet-3")],
            media: (
              <AnamnesisCard
                title={t("anamnesis-title")}
                fields={[
                  {
                    label: t("anamnesis-f1-label"),
                    value: t("anamnesis-f1-value"),
                    state: "clear",
                    stateLabel: t("state-clear"),
                  },
                ]}
                source={{ label: t("trace-source-label"), quote: t("trace-source-quote") }}
              />
            ),
            tone: "secondary",
          },
        ]}
      />

      <Section spacing="compact">
        <p className="text-text-secondary mx-auto max-w-2xl text-center text-sm leading-6">{t("sec-caution")}</p>
      </Section>

      <Cta
        kicker={t("cta-kicker")}
        title={t("cta-title")}
        subtitle={t("cta-subtitle")}
        cta={{ label: t("cta-final-label"), href: "/auth/sign-up" }}
      />
    </>
  );
}
