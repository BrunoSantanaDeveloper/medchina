import { getDisplayPlans } from "./plans";
import { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@mui/material";

import { BRAND } from "@/brand";
import AnamnesisDemo from "@/components/marketing/anamnesis-demo";
import Comparison from "@/components/marketing/comparison";
import ConsultationDuo from "@/components/marketing/consultation-duo";
import Cta from "@/components/marketing/cta";
import Faq from "@/components/marketing/faq";
import Hero from "@/components/marketing/hero";
import IndexGrid from "@/components/marketing/index-grid";
import JsonLd from "@/components/marketing/json-ld";
import MobileSequence from "@/components/marketing/mobile-sequence";
import NumberStrip from "@/components/marketing/number-strip";
import { AgendaMock, RecordingMock, StatusMock } from "@/components/marketing/phone-frame";
import PricingSection from "@/components/marketing/pricing-section";
import RuledGrid from "@/components/marketing/ruled-grid";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import TraceabilityDemo, { SourceLegend } from "@/components/marketing/traceability-demo";
import WorkflowDemo from "@/components/marketing/workflow-demo";
import NiAi from "@/icons/nexture/ni-ai";
import NiArrowHistory from "@/icons/nexture/ni-arrow-history";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import NiCompass from "@/icons/nexture/ni-compass";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiHeart from "@/icons/nexture/ni-heart";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiLock from "@/icons/nexture/ni-lock";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPen from "@/icons/nexture/ni-pen";
import NiPlay from "@/icons/nexture/ni-play";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiTextQuote from "@/icons/nexture/ni-text-quote";

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
 * Home rebuilt 1:1 on the committed reference blueprint (docs/DESIGN.md,
 * "Reference blueprint" table — order is FIXED): hero (consultation duo) →
 * numbered trust strip → interactive workflow demo → before/after → benefits
 * ruled grid → mobile deep band (3 screens) → anamnesis demo → clinical
 * reasoning → MTC index grid → traceability → plans → FAQ (split) → security
 * deep band → final deep CTA. Deviations are documented on the table.
 *
 * Family → hue mapping (docs/DESIGN.md, consistent site-wide):
 * jade accent-1 = clear evidence / patient report; slate accent-2 =
 * organization / web platform; terracotta accent-3 = needs attention / live
 * recording; plum accent-4 = AI inference / Pro; camel secondary = professional
 * observation/decision + editorial ordinals. Red never decorates — risk only.
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

      {/* §10 Hero: the consultation duo — web record panel as the frame, the
          phone recording as the front satellite, reassurance chips under the copy. */}
      <Hero
        layout="split"
        eyebrow={t("hero-eyebrow")}
        title={t.rich("hero-title", { em: (chunks) => <em>{chunks}</em> })}
        subtitle={t("hero-subtitle")}
        primaryCta={{ label: t("cta-primary"), href: "/auth/sign-up" }}
        secondaryCta={{ label: t("hero-secondary"), href: "/como-funciona", icon: <NiPlay size="small" /> }}
        note={t("hero-note")}
        highlights={[t("hero-highlight-1"), t("hero-highlight-2"), t("hero-highlight-3"), t("hero-highlight-4")]}
        media={
          <ConsultationDuo
            ariaLabel={t("mock-web-aria")}
            labels={{
              web: {
                brand: BRAND.name,
                search: t("mock-web-search"),
                kicker: t("mock-web-kicker"),
                title: t("mock-web-title"),
                reviewChip: t("chip-review-value"),
                tabs: [t("mock-web-tab-1"), t("mock-web-tab-2"), t("mock-web-tab-3"), t("mock-web-tab-4")],
                fields: [
                  {
                    label: t("anamnesis-f1-label"),
                    stateLabel: stateLabels.clear,
                    text: t("trace-demo-value"),
                    source: t("duo-source-1"),
                    state: "clear",
                  },
                  {
                    label: t("anamnesis-f2-label"),
                    stateLabel: stateLabels.attention,
                    text: t("anamnesis-f2-value"),
                    source: t("duo-source-2"),
                    state: "attention",
                  },
                  {
                    label: t("ana-row-3-label"),
                    stateLabel: stateLabels.empty,
                    text: t("duo-empty-hint"),
                    state: "empty",
                  },
                ],
                changesKicker: t("chip-changes-label"),
                changesTitle: t("mock-web-changes-title"),
                changes: [t("mock-web-change-1"), t("mock-web-change-2"), t("mock-web-change-3")],
                changesCta: t("mock-web-cta"),
              },
              phone: {
                navTitle: t("duo-phone-nav"),
                patient: t("mock-patient"),
                consent: t("wf-consent-title"),
                statusLabel: t("mock-recording"),
                timer: t("mock-timer"),
                pauseLabel: t("mock-pause"),
                voiceLabel: t("mock-voice"),
                finishLabel: t("mock-finish"),
              },
              notes: {
                one: { title: t("duo-note-1-title"), sub: t("duo-note-1-sub") },
                two: { badge: "03", title: t("duo-note-2-title"), sub: t("duo-note-2-sub") },
              },
            }}
          />
        }
      />

      {/* §11 Trust strip: the adoption path as a numbered contrast band. */}
      <NumberStrip
        items={[
          { title: t("trust-1-title"), body: t("trust-1-body") },
          { title: t("trust-2-title"), body: t("trust-2-body") },
          { title: t("trust-3-title"), body: t("trust-3-body") },
          { title: t("trust-4-title"), body: t("trust-4-body") },
        ]}
      />

      {/* §12 Interactive workflow demo: the same information travelling
          conversa → anamnese → análise → plano. */}
      <Section id="fluxo" decor="gradient-edge">
        <SectionHeader eyebrow={t("flow-eyebrow")} title={t("flow-title")} subtitle={t("flow-subtitle")} />
        <WorkflowDemo
          tabsLabel={t("wf-tabs-label")}
          conversation={{
            tab: t("wf-1-tab"),
            hint: t("wf-1-hint"),
            pill: t("wf-1-pill"),
            title: t("wf-1-title"),
            body: t("wf-1-body"),
            consentTitle: t("wf-consent-title"),
            consentNote: t("wf-consent-note"),
            speakerKicker: t("trace-source-label"),
            quote: t("wf-quote"),
            speakers: [t("wf-speaker-patient"), t("wf-speaker-professional")],
            protectedLabel: t("wf-protected"),
            timeStart: "14:32",
            timeEnd: "15:08",
          }}
          mapping={{
            tab: t("wf-2-tab"),
            hint: t("wf-2-hint"),
            pill: t("wf-2-pill"),
            title: t("wf-2-title"),
            body: t("wf-2-body"),
            quote: t("wf-map-quote"),
            quoteSource: t("trace-source-label"),
            fieldKicker: t("anamnesis-f1-label"),
            fieldValue: t("wf-field-value"),
            fieldMeta: t("wf-field-meta"),
          }}
          analysis={{
            tab: t("wf-3-tab"),
            hint: t("wf-3-hint"),
            pill: t("wf-3-pill"),
            title: t("wf-3-title"),
            body: t("wf-3-body"),
            items: [
              { kind: "change", title: t("wf-a1-title"), note: t("wf-a1-note") },
              { kind: "investigate", title: t("wf-a2-title"), note: t("wf-a2-note") },
              { kind: "attention", title: stateLabels.attention, note: t("wf-a3-note") },
            ],
          }}
          plan={{
            tab: t("wf-4-tab"),
            hint: t("wf-4-hint"),
            pill: t("wf-4-pill"),
            title: t("wf-4-title"),
            body: t("wf-4-body"),
            rows: [
              { badge: t("wf-p1-badge"), title: t("wf-p1-title"), note: t("wf-p1-note"), tag: t("wf-p1-tag") },
              {
                badge: t("wf-p2-badge"),
                title: t("wf-p2-title"),
                note: t("wf-p2-note"),
                tag: t("wf-p2-tag"),
                professional: true,
              },
            ],
            cta: t("wf-validate"),
          }}
        />
        <div className="mt-8 flex flex-col items-center gap-2 text-center">
          <Link
            href="/como-funciona"
            className="text-primary border-primary/30 hover:border-primary border-b pb-0.5 text-sm font-bold transition-colors"
          >
            {t("flow-cta")}
          </Link>
          <p className="text-text-secondary text-sm">{t("flow-cta-note")}</p>
        </div>
      </Section>

      {/* §13 Problem → transformation: before / with MedChina, bridged. */}
      <Section background="paper" id="recursos">
        {/* Blueprint §13 split intro: heading left, supporting paragraph right, baseline-aligned. */}
        <div className="mb-10 grid grid-cols-1 items-end gap-6 md:mb-14 md:grid-cols-[1fr_0.78fr] md:gap-20">
          <SectionHeader
            eyebrow={t("problem-eyebrow")}
            title={t("problem-title")}
            align="start"
            className="mb-0 md:mb-0"
          />
          <p className="text-text-secondary text-lg leading-7">{t("problem-subtitle")}</p>
        </div>
        <Comparison
          before={{
            label: t("problem-before-title"),
            title: t("problem-before-heading"),
            items: [1, 2, 3, 4, 5].map((index) => t(`problem-before-${index}`)),
          }}
          after={{
            label: t("problem-after-title"),
            title: t("problem-after-heading"),
            items: [1, 2, 3, 4, 5].map((index) => t(`problem-after-${index}`)),
          }}
        />
      </Section>

      {/* §14 Benefits: the ruled 3×2 grid, meaningful icon per family. */}
      <Section>
        <SectionHeader eyebrow={t("bento-eyebrow")} title={t("bento-title")} />
        <RuledGrid
          items={[
            {
              icon: <NiHeart size="large" />,
              title: t("benefit-1-title"),
              body: t("benefit-1-body"),
              tone: "secondary",
            },
            {
              icon: <NiListCheck size="large" />,
              title: t("benefit-2-title"),
              body: t("benefit-2-body"),
              tone: "accent-1",
            },
            {
              icon: <NiArrowHistory size="large" />,
              title: t("benefit-3-title"),
              body: t("benefit-3-body"),
              tone: "accent-2",
            },
            { icon: <NiAi size="large" />, title: t("benefit-4-title"), body: t("benefit-4-body"), tone: "accent-4" },
            {
              icon: <NiClipboard size="large" />,
              title: t("benefit-5-title"),
              body: t("benefit-5-body"),
              tone: "accent-3",
            },
            { icon: <NiPen size="large" />, title: t("benefit-6-title"), body: t("benefit-6-body"), tone: "accent-1" },
          ]}
        />
      </Section>

      {/* §15 Mobile: the deep band + the three companion-app screens. */}
      <Section background="deep" id="mobile">
        <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-secondary-light mb-3 text-sm font-semibold tracking-wide uppercase">
              {t("mobile-eyebrow")}
            </p>
            <h2 className="font-display text-display-lg font-bold">{t("mobile-title")}</h2>
            <p className="text-text-contrast/75 mt-4 text-lg leading-7">{t("mobile-body")}</p>
            <ul className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {[1, 2, 3, 4].map((index) => (
                <li key={index} className="text-text-contrast/85 flex items-start gap-2.5 text-sm leading-5">
                  <span
                    aria-hidden
                    className="bg-text-contrast/10 text-secondary-light mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full text-xs font-bold"
                  >
                    ✓
                  </span>
                  {t(`mobile-bullet-${index}`)}
                </li>
              ))}
            </ul>
            <div className="border-text-contrast/15 bg-text-contrast/5 mt-6 flex items-start gap-3.5 rounded-2xl border p-4">
              <span aria-hidden className="text-secondary-light mt-0.5 flex-none">
                <NiRefresh size="medium" />
              </span>
              <span>
                <span className="font-display block text-base font-bold">{t("mobile-highlight-title")}</span>
                <span className="text-text-contrast/70 mt-1 block text-sm leading-5">{t("mobile-highlight-body")}</span>
              </span>
            </div>
            <p className="text-text-contrast/55 mt-4 text-xs leading-5">{t("mobile-note")}</p>
          </div>

          {/* Blueprint §15.7: the fanned three-screen sequence over the ring. */}
          <MobileSequence
            ariaLabel={t("seq-aria")}
            back={
              <AgendaMock
                heading={t("mock-agenda-title")}
                items={[
                  { time: "09:00", name: t("mock-patient"), note: t("mock-agenda-1-note") },
                  { time: "11:30", name: t("mock-agenda-2-name"), note: t("mock-agenda-2-note") },
                  { time: "15:00", name: t("mock-agenda-3-name"), note: t("mock-agenda-3-note") },
                ]}
              />
            }
            front={
              <RecordingMock
                patient={t("mock-patient")}
                statusLabel={t("mock-recording")}
                timer={t("mock-timer")}
                pauseLabel={t("mock-pause")}
                voiceLabel={t("mock-voice")}
                finishLabel={t("mock-finish")}
              />
            }
            side={
              <StatusMock
                title={t("mock-status-title")}
                subtitle={t("mock-status-subtitle")}
                steps={[
                  { label: t("mock-status-1"), note: t("mock-status-1-note"), state: "done" },
                  { label: t("mock-status-2"), note: t("mock-status-2-note"), state: "current" },
                ]}
              />
            }
          />
        </div>
      </Section>

      {/* §16 Anamnesis demo: quote → supervised organization → prepared fields. */}
      <Section background="paper" decor="dots" id="anamnese">
        <SectionHeader eyebrow={t("rows-eyebrow")} title={t("row-anamnese-title")} subtitle={t("row-anamnese-body")} />
        <AnamnesisDemo
          quote={{ kicker: t("ana-quote-kicker"), text: t("ana-quote"), cite: t("ana-cite") }}
          connectorLabel={t("ana-connector")}
          prepared={{
            kicker: t("ana-prep-kicker"),
            title: t("ana-prep-title"),
            countChip: t("ana-prep-count"),
            rows: [
              {
                label: t("anamnesis-f1-label"),
                value: t("anamnesis-f1-value"),
                state: "clear",
                stateLabel: stateLabels.clear,
              },
              {
                label: t("ana-row-2-label"),
                value: t("ana-row-2-value"),
                state: "attention",
                stateLabel: stateLabels.attention,
              },
              {
                label: t("ana-row-3-label"),
                value: t("ana-row-3-value"),
                state: "empty",
                stateLabel: stateLabels.empty,
              },
            ],
            investigation: { title: t("ana-invest-title"), body: t("ana-invest-body") },
          }}
        />
      </Section>

      {/* §17 Clinical reasoning (Pro): possibilities prepared, conduct decided. */}
      <Section decor="gradient-edge">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeader
            eyebrow={t("row-pro-eyebrow")}
            title={t("row-pro-title")}
            subtitle={t("reason-subtitle")}
            align="start"
            className="mb-0 md:mb-0"
          />
          <Button
            variant="pastel"
            color="primary"
            size="large"
            href="/planos"
            LinkComponent={Link}
            className="flex-none"
          >
            {t("reason-cta")}
          </Button>
        </div>
        <div className="mt-10 md:mt-14">
          <RuledGrid
            variant="cards"
            items={[
              {
                icon: <NiAi size="large" />,
                title: t("reason-1-title"),
                body: t("reason-1-body"),
                tone: "accent-4",
                link: { label: t("reason-link"), href: "#rastreabilidade" },
              },
              {
                icon: <NiCompass size="large" />,
                title: t("reason-2-title"),
                body: t("reason-2-body"),
                tone: "accent-2",
              },
              {
                icon: <NiDocumentCheck size="large" />,
                title: t("reason-3-title"),
                body: t("reason-3-body"),
                tone: "secondary",
              },
            ]}
          />
        </div>
        <p className="border-grey-100 bg-background-paper text-text-secondary mt-8 flex items-start gap-3 rounded-2xl border p-4 text-sm leading-5">
          <NiTextQuote size="small" className="text-secondary mt-0.5 flex-none" />
          {t("reason-safety")}
        </p>
      </Section>

      {/* §18 MTC specialization: copy beside the indexed category map. */}
      <Section background="paper">
        <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-16">
          <div>
            <SectionHeader
              eyebrow={t("mtc-eyebrow")}
              title={t("mtc-title")}
              subtitle={t("mtc-subtitle")}
              align="start"
              className="mb-0 md:mb-0"
            />
            <blockquote className="border-grey-100 mt-8 flex gap-4 border-t pt-6">
              <span aria-hidden className="font-display text-secondary text-4xl leading-none font-bold">
                “
              </span>
              <p className="text-text-secondary text-base leading-6 italic">{t("mtc-support")}</p>
            </blockquote>
          </div>
          <IndexGrid items={Array.from({ length: 16 }, (_, index) => t(`mtc-cat-${index + 1}`))} />
        </div>
      </Section>

      {/* §19 Traceability: the provenance demo + the four-source legend. */}
      <Section id="rastreabilidade">
        <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-16">
          {/* Copy first in the DOM (mobile reads the argument before the proof);
              at md+ the demo takes the left column, blueprint §19. */}
          <div className="md:order-2">
            <SectionHeader
              eyebrow={t("row-trace-eyebrow")}
              title={t("row-trace-title")}
              subtitle={t("row-trace-body")}
              align="start"
              className="mb-0 md:mb-0"
            />
            {/* §19.4 — same family→hue mapping as everywhere else on the site. */}
            <SourceLegend
              items={[
                { label: t("legend-patient"), tone: "accent-1" },
                { label: t("legend-professional"), tone: "secondary" },
                { label: t("legend-ai"), tone: "accent-4" },
                { label: t("legend-decision"), tone: "primary" },
              ]}
            />
          </div>
          <div className="md:order-1">
            <TraceabilityDemo
              ariaLabel={t("trace-demo-aria")}
              kicker={t("trace-demo-kicker")}
              chip={t("trace-demo-chip")}
              field={t("anamnesis-f1-label")}
              value={t("trace-demo-value")}
              origin={{ kicker: t("trace-origin-kicker"), quote: t("trace-source-quote"), timecode: "00:08" }}
              actions={{
                listen: t("trace-listen"),
                edit: t("trace-edit"),
                reject: t("trace-reject"),
                validated: t("trace-validated"),
              }}
            />
          </div>
        </div>
      </Section>

      {/* §20 Plans: catalog-driven prices, automation ladder, difference line. */}
      <PricingSection
        id="planos"
        eyebrow={t("pricing-eyebrow")}
        title={t("pricing-title")}
        subtitle={t("pricing-subtitle")}
        plans={plans}
        ctaLabel={t("cta-primary")}
        decor="gradient-edge"
        tiers={[t("pricing-tier-1"), t("pricing-tier-2"), t("pricing-tier-3")]}
        footnote={t("pricing-difference")}
      />

      {/* §24 FAQ: split layout — sticky intro + the real objections. */}
      <Faq
        id="duvidas"
        layout="split"
        eyebrow={t("faq-eyebrow")}
        title={t("faq-title")}
        subtitle={t("faq-subtitle")}
        link={{ label: t("cta-primary"), href: "/auth/sign-up" }}
        items={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => ({
          question: t(`faq-${index}-question`),
          answer: t(`faq-${index}-answer`),
        }))}
      />

      {/* §22 Security: deep band, copy + four ruled pillars. */}
      <Section background="deep" id="seguranca">
        <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-secondary-light mb-3 text-sm font-semibold tracking-wide uppercase">
              {t("security-eyebrow")}
            </p>
            <h2 className="font-display text-display-lg font-bold">{t("security-title")}</h2>
            <p className="text-text-contrast/75 mt-4 text-lg leading-7">{t("security-subtitle")}</p>
          </div>
          <RuledGrid
            variant="deep"
            columns={2}
            items={[
              { icon: <NiClipboard size="large" />, title: t("security-1-title"), body: t("security-1-body") },
              { icon: <NiMicrophone size="large" />, title: t("security-2-title"), body: t("security-2-body") },
              { icon: <NiLock size="large" />, title: t("security-3-title"), body: t("security-3-body") },
              { icon: <NiArrowHistory size="large" />, title: t("security-4-title"), body: t("security-4-body") },
            ]}
          />
        </div>
      </Section>

      {/* §25 Final CTA: deep band + orbit; label differs from cta-primary by
          spec mandate (§25.4); reassurance points close the risk story. */}
      <Cta
        variant="deep"
        decor="orbit"
        kicker={t("cta-kicker")}
        title={t("cta-title")}
        subtitle={t("cta-subtitle")}
        cta={{ label: t("cta-final-label"), href: "/auth/sign-up" }}
        secondaryCta={{ label: t("hero-secondary"), href: "/como-funciona" }}
        points={[t("cta-point-1"), t("cta-point-2"), t("cta-point-3"), t("cta-point-4")]}
      />
    </>
  );
}
