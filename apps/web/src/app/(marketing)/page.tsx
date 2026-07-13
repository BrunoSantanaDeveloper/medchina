import { getDisplayPlans } from "./plans";
import { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@mui/material";

import { BRAND } from "@/brand";
import AnamnesisCard from "@/components/marketing/anamnesis-card";
import BentoGrid from "@/components/marketing/bento-grid";
import Breakout from "@/components/marketing/breakout";
import Cta from "@/components/marketing/cta";
import Faq from "@/components/marketing/faq";
import FeatureGrid from "@/components/marketing/feature-grid";
import FeatureRows from "@/components/marketing/feature-row";
import Float from "@/components/marketing/float";
import Hero from "@/components/marketing/hero";
import JsonLd from "@/components/marketing/json-ld";
import PhoneFrame, { RecordingMock } from "@/components/marketing/phone-frame";
import PricingSection from "@/components/marketing/pricing-section";
import ProcessSteps from "@/components/marketing/process-steps";
import ProductComposition from "@/components/marketing/product-composition";
import { KpiChip, TrendChip } from "@/components/marketing/satellite-chips";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import { TONE } from "@/components/marketing/tone";
import NiAi from "@/icons/nexture/ni-ai";
import NiArrowHistory from "@/icons/nexture/ni-arrow-history";
import NiBadgeCheck from "@/icons/nexture/ni-badge-check";
import NiCheck from "@/icons/nexture/ni-check";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import NiCross from "@/icons/nexture/ni-cross";
import NiEyeOpen from "@/icons/nexture/ni-eye-open";
import NiHeart from "@/icons/nexture/ni-heart";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiLock from "@/icons/nexture/ni-lock";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPen from "@/icons/nexture/ni-pen";
import NiPhone from "@/icons/nexture/ni-phone";
import NiSearch from "@/icons/nexture/ni-search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  // `absolute` bypasses the root "%s | Brand" template so the home title reads
  // as one line (docs/HOME-SPEC.md §29.1), keyword-led and under ~60 chars.
  return {
    title: { absolute: `${BRAND.name} | ${t("home-meta-title")}` },
    description: t("home-meta-description"),
  };
}

/**
 * Home built section-by-section from docs/HOME-SPEC.md §8 (contractual order):
 * hero → trust strip → workflow → problem/transformation → benefits → mobile
 * app (breakout) → anamnesis + Pro reasoning + traceability (FeatureRows,
 * §8/9/11 merged into one zig-zag — documented deviation) → MTC specialization
 * → plans → migration note → FAQ → security → final CTA.
 *
 * Documented deviations from the spec: LogoCloud/testimonials/stat claims are
 * intentionally ABSENT (§33.5 — no social proof without real data); the final
 * CTA label differs from the primary CTA by spec mandate (§25.4).
 *
 * Family → hue mapping (docs/DESIGN.md, consistent site-wide):
 * jade accent-1 = clear evidence / free-manual work; slate accent-2 =
 * organization / web platform; terracotta accent-3 = needs attention / live
 * recording; plum accent-4 = AI inference / Pro; camel secondary = presence /
 * professional warmth. Red never decorates — risk only.
 */
export default async function Home() {
  const [t, plans] = await Promise.all([getTranslations("marketing"), getDisplayPlans()]);

  const stateLabels = {
    clear: t("state-clear"),
    attention: t("state-attention"),
    empty: t("state-empty"),
  };

  return (
    <>
      {/* SoftwareApplication schema (docs/SEO.md) — no ratings/offers until real. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: BRAND.name,
          applicationCategory: "MedicalApplication",
          operatingSystem: "Web, iOS, Android",
          description: t("home-meta-description"),
          url: BRAND.siteUrl,
        }}
      />

      {/* §10 Hero: first fold = eyebrow, fixed headline, authorized-recording
          explainer, both CTAs, microcopy, mobile recording mock + web anamnesis. */}
      <Hero
        layout="split"
        eyebrow={t("hero-eyebrow")}
        title={t("hero-title")}
        subtitle={t("hero-subtitle")}
        primaryCta={{ label: t("cta-primary"), href: "/auth/sign-up" }}
        secondaryCta={{ label: t("hero-secondary"), href: "/como-funciona" }}
        note={t("hero-note")}
        media={
          <ProductComposition
            frame={
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
            }
            satellites={[
              {
                children: (
                  <PhoneFrame className="w-44">
                    <RecordingMock
                      patient={t("mock-patient")}
                      statusLabel={t("mock-recording")}
                      timer={t("mock-timer")}
                      pauseLabel={t("mock-pause")}
                      voiceLabel={t("mock-voice")}
                      finishLabel={t("mock-finish")}
                    />
                  </PhoneFrame>
                ),
                position: "bottom-left",
                depth: "front",
                rotate: -3,
                float: true,
              },
              {
                children: <KpiChip label={t("chip-review-label")} value={t("chip-review-value")} tone="accent-1" />,
                position: "top-right",
                depth: "front",
                rotate: 3,
                float: true,
                floatDelay: 0.8,
              },
              {
                children: <TrendChip label={t("chip-changes-label")} tone="accent-2" />,
                position: "right",
                depth: "back",
                hideBelow: "md",
              },
            ]}
          />
        }
      />

      {/* §11 Trust strip: free base, opt-in automation, review, web+mobile. */}
      <FeatureGrid
        title={t("trust-title")}
        features={[
          {
            icon: <NiBadgeCheck size="large" />,
            title: t("trust-1-title"),
            description: t("trust-1-body"),
            tone: "accent-1",
          },
          { icon: <NiAi size="large" />, title: t("trust-2-title"), description: t("trust-2-body"), tone: "accent-4" },
          {
            icon: <NiEyeOpen size="large" />,
            title: t("trust-3-title"),
            description: t("trust-3-body"),
            tone: "accent-3",
          },
          {
            icon: <NiPhone size="large" />,
            title: t("trust-4-title"),
            description: t("trust-4-body"),
            tone: "accent-2",
          },
        ]}
      />

      {/* §12 Workflow: atenda → organiza → destaca → você decide. */}
      <ProcessSteps
        id="fluxo"
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
      <Section spacing="compact" className="text-center">
        <Button variant="pastel" color="primary" size="large" href="/como-funciona" LinkComponent={Link}>
          {t("flow-cta")}
        </Button>
        <p className="text-text-secondary mt-3 text-sm">{t("flow-cta-note")}</p>
      </Section>

      {/* §13 Problem → transformation (before / with MedChina, no blame language). */}
      <Section background="paper" decor="gradient-edge">
        <SectionHeader title={t("problem-title")} subtitle={t("problem-subtitle")} />
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
          <div className="border-grey-100 bg-background rounded-3xl border p-6">
            <p className="text-text-secondary text-sm font-semibold tracking-wide uppercase">
              {t("problem-before-title")}
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {[1, 2, 3, 4, 5].map((index) => (
                <li key={index} className="text-text-secondary flex items-start gap-2.5 text-base leading-6">
                  <NiCross size="small" className="text-grey-500 mt-0.5 flex-none" />
                  {t(`problem-before-${index}`)}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-accent-1/30 bg-accent-1/5 rounded-3xl border p-6">
            <p className="text-accent-1-dark dark:text-accent-1-light text-sm font-semibold tracking-wide uppercase">
              {t("problem-after-title")}
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {[1, 2, 3, 4, 5].map((index) => (
                <li key={index} className="text-text-primary flex items-start gap-2.5 text-base leading-6">
                  <NiCheck size="small" className="text-accent-1 mt-0.5 flex-none" />
                  {t(`problem-after-${index}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* §14 Benefits bento — six benefit families, two featured. */}
      <BentoGrid
        eyebrow={t("bento-eyebrow")}
        title={t("bento-title")}
        items={[
          {
            title: t("benefit-1-title"),
            body: t("benefit-1-body"),
            visual: <NiHeart className="h-10 w-10" />,
            featured: true,
            tone: "secondary",
          },
          {
            title: t("benefit-2-title"),
            body: t("benefit-2-body"),
            visual: <NiListCheck className="h-10 w-10" />,
            tone: "accent-1",
          },
          {
            title: t("benefit-3-title"),
            body: t("benefit-3-body"),
            visual: <NiArrowHistory className="h-10 w-10" />,
            tone: "accent-2",
          },
          {
            title: t("benefit-4-title"),
            body: t("benefit-4-body"),
            visual: <NiAi className="h-10 w-10" />,
            featured: true,
            tone: "accent-4",
          },
          {
            title: t("benefit-5-title"),
            body: t("benefit-5-body"),
            visual: <NiClipboard className="h-10 w-10" />,
            tone: "accent-3",
          },
          {
            title: t("benefit-6-title"),
            body: t("benefit-6-body"),
            visual: <NiPen className="h-10 w-10" />,
            tone: "accent-1",
          },
        ]}
      />

      {/* §15 Mobile app — the page's one breakout, on the elevated contrast band:
          phone escapes to the edge; copy carries the offline-resilience story. */}
      <Section bleed background="contrast" decor="dots" className="overflow-x-clip" id="mobile">
        <Breakout
          side="right"
          media={
            <div className="bg-background flex flex-col items-center gap-6 p-8 sm:flex-row sm:justify-center md:p-10">
              <Float rotate={-2}>
                <PhoneFrame className="w-52">
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
              <ul className="flex w-full max-w-56 flex-col gap-2">
                {(["upload-1", "upload-2", "upload-3"] as const).map((key, index) => (
                  <li
                    key={key}
                    className={
                      index === 2
                        ? "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light rounded-xl px-3.5 py-2.5 text-xs font-bold"
                        : "bg-background-paper border-grey-100 text-text-secondary rounded-xl border px-3.5 py-2.5 text-xs font-semibold"
                    }
                  >
                    {t(key)}
                  </li>
                ))}
              </ul>
            </div>
          }
        >
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
          <div className="border-grey-100 bg-background-paper mt-6 rounded-2xl border p-4">
            <p className="text-text-primary text-sm font-bold">{t("mobile-highlight-title")}</p>
            <p className="text-text-secondary mt-1 text-sm leading-6">{t("mobile-highlight-body")}</p>
          </div>
          <p className="text-text-secondary mt-4 text-xs leading-5">{t("mobile-note")}</p>
        </Breakout>
      </Section>

      {/* §16/§17/§19 merged: anamnesis filling, Pro reasoning, traceability —
          three zig-zag rows, each with the field-state motif as evidence. */}
      <FeatureRows
        id="anamnese"
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
                  { label: t("anamnesis-f5-label"), state: "empty", stateLabel: stateLabels.empty },
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
          {
            eyebrow: t("row-trace-eyebrow"),
            title: t("row-trace-title"),
            body: t("row-trace-body"),
            bullets: [
              t("row-trace-bullet-1"),
              t("row-trace-bullet-2"),
              t("row-trace-bullet-3"),
              t("row-trace-bullet-4"),
            ],
            media: (
              <AnamnesisCard
                title={t("anamnesis-title")}
                fields={[
                  {
                    label: t("anamnesis-f1-label"),
                    value: t("anamnesis-f1-value"),
                    state: "clear",
                    stateLabel: stateLabels.clear,
                  },
                ]}
                source={{ label: t("trace-source-label"), quote: t("trace-source-quote") }}
              />
            ),
            tone: "secondary",
          },
        ]}
      />

      {/* §18 MTC specialization — the category map as a tone-dotted chip cloud. */}
      <Section decor="gradient-edge">
        <SectionHeader eyebrow={t("mtc-eyebrow")} title={t("mtc-title")} subtitle={t("mtc-subtitle")} />
        <ul className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2.5">
          {Array.from({ length: 16 }, (_, index) => index + 1).map((index) => {
            const tones = ["accent-1", "accent-2", "accent-3", "accent-4", "secondary"] as const;
            const tone = TONE[tones[index % tones.length]];
            return (
              <li
                key={index}
                className="border-grey-100 bg-background-paper text-text-primary flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: `hsl(var(${tone.cssVar}))` }}
                />
                {t(`mtc-cat-${index}`)}
              </li>
            );
          })}
        </ul>
        <p className="text-text-secondary mx-auto mt-8 max-w-2xl text-center text-base leading-6">{t("mtc-support")}</p>
      </Section>

      {/* §20 Plans — real billing rows or the i18n hypothesis placeholders. */}
      <PricingSection
        id="planos"
        eyebrow={t("pricing-eyebrow")}
        title={t("pricing-title")}
        subtitle={t("pricing-subtitle")}
        plans={plans}
        ctaLabel={t("cta-primary")}
      />

      {/* §23 Previous-version users — deliberately discreet, near the FAQ. */}
      <Section spacing="compact">
        <div className="border-grey-100 bg-background-paper mx-auto flex max-w-3xl flex-col items-start gap-3 rounded-3xl border p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-text-primary font-display text-base font-bold">{t("migration-title")}</p>
            <p className="text-text-secondary mt-1 text-sm leading-6">{t("migration-body")}</p>
          </div>
          <Button variant="pastel" color="primary" href="/migracao" LinkComponent={Link} className="flex-none">
            {t("migration-cta")}
          </Button>
        </div>
      </Section>

      {/* §24 FAQ — the real objections (grátis, trial, cartão, controle, gravação…). */}
      <Faq
        id="duvidas"
        eyebrow={t("faq-eyebrow")}
        title={t("faq-title")}
        items={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => ({
          question: t(`faq-${index}-question`),
          answer: t(`faq-${index}-answer`),
        }))}
      />

      {/* §22 Security & privacy pillars. */}
      <FeatureGrid
        eyebrow={t("security-eyebrow")}
        title={t("security-title")}
        subtitle={t("security-subtitle")}
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
      <Section spacing="compact" className="-mt-8 text-center">
        <Button variant="text" color="primary" href="/seguranca" LinkComponent={Link}>
          {t("security-cta")}
        </Button>
      </Section>

      {/* §25 Final CTA — label differs from cta-primary by spec mandate (§25.4). */}
      <Cta
        kicker={t("cta-kicker")}
        decor="orbit"
        title={t("cta-title")}
        subtitle={t("cta-subtitle")}
        cta={{ label: t("cta-final-label"), href: "/auth/sign-up" }}
      />
    </>
  );
}
