import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import AnamnesisCard from "@/components/marketing/anamnesis-card";
import Cta from "@/components/marketing/cta";
import FeatureGrid from "@/components/marketing/feature-grid";
import FeatureRows from "@/components/marketing/feature-row";
import Float from "@/components/marketing/float";
import PhoneFrame, { RecordingMock } from "@/components/marketing/phone-frame";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import NiBook from "@/icons/nexture/ni-book";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCheck from "@/icons/nexture/ni-check";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiHearts from "@/icons/nexture/ni-hearts";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiUsers from "@/icons/nexture/ni-users";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  return {
    title: t("features-meta-title"),
    description: t("features-meta-description"),
    alternates: { canonical: "/recursos" },
  };
}

/**
 * /recursos — feature depth (HOME-SPEC §28): the manual clinical platform
 * (free tier, PRD §9), the companion mobile app (anchor #mobile, linked from
 * the footer) and the AI layer (Assistente/Pro) with the field-state motif.
 */
export default async function FeaturesPage() {
  const t = await getTranslations("marketing");

  const stateLabels = {
    clear: t("state-clear"),
    attention: t("state-attention"),
    empty: t("state-empty"),
  };

  return (
    <>
      <Section decor="glow" spacing="compact">
        <SectionHeader
          as="h1"
          eyebrow={t("hero-eyebrow")}
          title={t("features-page-title")}
          subtitle={t("features-page-subtitle")}
        />
      </Section>

      {/* The free manual platform (PRD §9) — what every account gets, unlimited. */}
      <FeatureGrid
        eyebrow={t("feat-web-eyebrow")}
        title={t("feat-web-title")}
        subtitle={t("feat-web-subtitle")}
        features={[
          {
            icon: <NiUsers size="large" />,
            title: t("feat-web-1-title"),
            description: t("feat-web-1-body"),
            tone: "accent-1",
          },
          {
            icon: <NiCalendar size="large" />,
            title: t("feat-web-2-title"),
            description: t("feat-web-2-body"),
            tone: "accent-2",
          },
          {
            icon: <NiListCheck size="large" />,
            title: t("feat-web-3-title"),
            description: t("feat-web-3-body"),
            tone: "accent-1",
          },
          {
            icon: <NiHearts size="large" />,
            title: t("feat-web-4-title"),
            description: t("feat-web-4-body"),
            tone: "secondary",
          },
          {
            icon: <NiDocumentCheck size="large" />,
            title: t("feat-web-5-title"),
            description: t("feat-web-5-body"),
            tone: "accent-3",
          },
          {
            icon: <NiBook size="large" />,
            title: t("feat-web-6-title"),
            description: t("feat-web-6-body"),
            tone: "accent-4",
          },
        ]}
      />

      {/* Companion app — footer anchor target (#mobile). */}
      <Section id="mobile" background="contrast" decor="dots">
        <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-[1fr_auto] md:gap-16">
          <div>
            <p className="text-accent-2 mb-3 text-sm font-semibold tracking-wide uppercase">{t("mobile-eyebrow")}</p>
            <h2 className="font-display text-display-lg text-text-primary font-bold">{t("mobile-title")}</h2>
            <p className="text-text-secondary mt-4 text-lg leading-7">{t("mobile-body")}</p>
            <ul className="mt-6 flex flex-col gap-3">
              {[1, 2, 3, 4].map((index) => (
                <li key={index} className="text-text-primary flex items-start gap-2.5 leading-6">
                  <NiCheck size="small" className="text-accent-2 mt-0.5 flex-none" />
                  {t(`mobile-bullet-${index}`)}
                </li>
              ))}
            </ul>
            <p className="text-text-secondary mt-6 text-xs leading-5">{t("mobile-note")}</p>
          </div>
          <Float rotate={-2} className="justify-self-center">
            <PhoneFrame className="w-56">
              <RecordingMock
                patient={t("mock-patient")}
                statusLabel={t("mock-recording")}
                timer={t("mock-timer")}
                pauseLabel={t("mock-pause")}
                voiceLabel={t("mock-voice")}
                finishLabel={t("mock-finish")}
              />
            </PhoneFrame>
          </Float>
        </div>
      </Section>

      {/* The AI layer — anamnesis filling and Pro reasoning, field-state motif. */}
      <FeatureRows
        decor="gradient-edge"
        eyebrow={t("rows-eyebrow")}
        title={t("rows-title")}
        subtitle={t("rows-subtitle")}
        items={[
          {
            eyebrow: t("row-anamnese-eyebrow"),
            title: t("row-anamnese-title"),
            body: t("row-anamnese-body"),
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
                  { label: t("anamnesis-f4-label"), state: "empty", stateLabel: stateLabels.empty },
                ]}
              />
            ),
            tone: "accent-1",
          },
          {
            eyebrow: t("row-pro-eyebrow"),
            title: t("row-pro-title"),
            body: t("row-pro-body"),
            bullets: [t("row-pro-bullet-1"), t("row-pro-bullet-2"), t("row-pro-bullet-3")],
            media: (
              <AnamnesisCard
                title={t("hypo-title")}
                subtitle={t("hypo-subtitle")}
                fields={[
                  {
                    label: t("hypo-f1-label"),
                    value: t("hypo-f1-value"),
                    state: "attention",
                    stateLabel: t("state-hypothesis"),
                  },
                  {
                    label: t("hypo-f2-label"),
                    value: t("hypo-f2-value"),
                    state: "clear",
                    stateLabel: stateLabels.clear,
                  },
                  {
                    label: t("hypo-f3-label"),
                    value: t("hypo-f3-value"),
                    state: "empty",
                    stateLabel: t("state-to-investigate"),
                  },
                ]}
              />
            ),
            tone: "accent-4",
          },
        ]}
      />

      <Cta
        kicker={t("cta-kicker")}
        title={t("cta-title")}
        subtitle={t("cta-subtitle")}
        cta={{ label: t("cta-final-label"), href: "/auth/sign-up" }}
      />
    </>
  );
}
