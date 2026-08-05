import { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@mui/material";

import AnamnesisCard from "@/components/marketing/anamnesis-card";
import Cta from "@/components/marketing/cta";
import FeatureRows from "@/components/marketing/feature-row";
import ProcessSteps from "@/components/marketing/process-steps";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPen from "@/icons/nexture/ni-pen";
import NiSearch from "@/icons/nexture/ni-search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  return {
    title: t("hiw-meta-title"),
    description: t("hiw-meta-description"),
    alternates: { canonical: "/como-funciona" },
  };
}

/**
 * /como-funciona — the demo-depth page (HOME-SPEC §12.4/§28): the consultation
 * flow step by step, then the state machines the product exposes (consultation
 * lifecycle + per-field review states), always with fictitious data. Quieter
 * than the home by design (docs/DESIGN.md open items) but keeps evidence and
 * two archetypes.
 */
export default async function HowItWorksPage() {
  const t = await getTranslations("marketing");

  const stateLabels = {
    clear: t("state-clear"),
    attention: t("state-attention"),
    empty: t("state-empty"),
  };

  return (
    <>
      <Section decor="glow" spacing="compact">
        <SectionHeader as="h1" eyebrow={t("hero-eyebrow")} title={t("hiw-title")} subtitle={t("hiw-subtitle")} />
        <div className="mx-auto max-w-xl">
          <AnamnesisCard
            title={t("anamnesis-title")}
            subtitle={t("anamnesis-subtitle")}
            fields={[
              {
                label: t("anamnesis-f1-label"),
                value: t("anamnesis-f1-value"),
                state: "clear",
                stateLabel: stateLabels.clear,
              },
              {
                label: t("anamnesis-f3-label"),
                value: t("anamnesis-f3-value"),
                state: "attention",
                stateLabel: stateLabels.attention,
              },
              { label: t("anamnesis-f4-label"), state: "empty", stateLabel: stateLabels.empty },
            ]}
            source={{ label: t("trace-source-label"), quote: t("trace-source-quote") }}
          />
        </div>
        <p className="text-text-secondary mt-6 text-center text-sm">{t("flow-cta-note")}</p>
      </Section>

      <ProcessSteps
        eyebrow={t("flow-eyebrow")}
        title={t("flow-title")}
        subtitle={t("flow-subtitle")}
        variant="icon"
        steps={[
          { icon: <NiMicrophone size="large" />, title: t("flow-1-title"), body: t("flow-1-body"), tone: "accent-2" },
          { icon: <NiListCheck size="large" />, title: t("flow-2-title"), body: t("flow-2-body"), tone: "accent-1" },
          { icon: <NiSearch size="large" />, title: t("flow-3-title"), body: t("flow-3-body"), tone: "accent-3" },
          { icon: <NiPen size="large" />, title: t("flow-4-title"), body: t("flow-4-body"), tone: "secondary" },
        ]}
      />

      <FeatureRows
        decor="gradient-edge"
        eyebrow={t("hiw-rows-eyebrow")}
        title={t("hiw-rows-title")}
        subtitle={t("hiw-rows-subtitle")}
        items={[
          {
            eyebrow: t("hiw-row-1-eyebrow"),
            title: t("hiw-row-1-title"),
            body: t("hiw-row-1-body"),
            bullets: [t("hiw-row-1-bullet-1"), t("hiw-row-1-bullet-2"), t("hiw-row-1-bullet-3")],
            media: (
              <div className="flex w-full flex-col gap-2">
                {(["upload-1", "upload-2", "upload-3"] as const).map((key, index) => (
                  <div
                    key={key}
                    className={
                      index === 2
                        ? "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light rounded-2xl px-5 py-4 text-sm font-bold"
                        : "bg-background-paper border-grey-100 text-text-secondary rounded-2xl border px-5 py-4 text-sm font-semibold"
                    }
                  >
                    {t(key)}
                  </div>
                ))}
              </div>
            ),
            tone: "accent-2",
          },
          {
            eyebrow: t("hiw-row-2-eyebrow"),
            title: t("hiw-row-2-title"),
            body: t("hiw-row-2-body"),
            bullets: [t("row-anamnese-bullet-1"), t("row-anamnese-bullet-2"), t("row-anamnese-bullet-3")],
            media: (
              <AnamnesisCard
                title={t("anamnesis-title")}
                subtitle={t("anamnesis-subtitle")}
                fields={[
                  {
                    label: t("anamnesis-f1-label"),
                    value: t("anamnesis-f1-value"),
                    state: "clear",
                    stateLabel: stateLabels.clear,
                  },
                  {
                    label: t("anamnesis-f2-label"),
                    value: t("anamnesis-f2-value"),
                    state: "clear",
                    stateLabel: stateLabels.clear,
                  },
                  {
                    label: t("anamnesis-f3-label"),
                    value: t("anamnesis-f3-value"),
                    state: "attention",
                    stateLabel: stateLabels.attention,
                  },
                  { label: t("anamnesis-f5-label"), state: "empty", stateLabel: stateLabels.empty },
                ]}
              />
            ),
            tone: "accent-1",
          },
        ]}
      />

      <Section spacing="compact" className="text-center">
        <Button variant="pastel" color="primary" size="large" href="/recursos" LinkComponent={Link}>
          {t("hiw-features-link")}
        </Button>
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
