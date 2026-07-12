import { getDisplayPlans } from "./plans";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { BRAND } from "@/brand";
import BentoGrid from "@/components/marketing/bento-grid";
import Breakout from "@/components/marketing/breakout";
import Cta from "@/components/marketing/cta";
import DataVizPlaceholder from "@/components/marketing/data-viz-placeholder";
import Faq from "@/components/marketing/faq";
import FeatureRows from "@/components/marketing/feature-row";
import Hero from "@/components/marketing/hero";
import LogoCloud from "@/components/marketing/logo-cloud";
import Parallax from "@/components/marketing/parallax";
import PricingSection from "@/components/marketing/pricing-section";
import ProductComposition from "@/components/marketing/product-composition";
import ProductFrame from "@/components/marketing/product-frame";
import { KpiChip, ReadoutChip, TrendChip } from "@/components/marketing/satellite-chips";
import Section from "@/components/marketing/section";
import StatBand from "@/components/marketing/stat-band";
import Testimonials from "@/components/marketing/testimonials";
import NiAi from "@/icons/nexture/ni-ai";
import NiCheck from "@/icons/nexture/ni-check";
import NiCreditCard from "@/icons/nexture/ni-credit-card";
import NiFlash from "@/icons/nexture/ni-flash";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  // `absolute` bypasses the root "%s | Brand" template so the home title reads
  // as one line: "Brand — value proposition" (keyword-led, under ~60 chars).
  return { title: { absolute: `${BRAND.name} — ${t("home-meta-title")}` } };
}

/**
 * Home = conversion funnel: hero (layered product evidence) → logos (trust) →
 * feature rows (flagship depth) → breakout (control-room proof) → bento
 * (secondary desire) → stat band (proof) → testimonials → pricing → FAQ → CTA.
 * The primary CTA label (cta-primary) repeats verbatim at every action point.
 *
 * Reference implementation of docs/DESIGN.md: a layered <ProductComposition>
 * hero, one <Breakout> full-bleed moment, oversized counting <StatBand>, and a
 * restrained ambient layer (2 floats + 1 parallax + 1 orbit).
 *
 * Family → hue mapping (consistent site-wide): data/analytics = primary
 * (the bold moment), tenancy/security = secondary, audit = accent-1,
 * day-one = accent-2, billing = accent-3, AI = accent-4.
 */
export default async function Home() {
  const [t, plans] = await Promise.all([getTranslations("marketing"), getDisplayPlans()]);

  return (
    <>
      <Hero
        layout="split"
        eyebrow={t("hero-eyebrow")}
        title={t("hero-title")}
        subtitle={t("hero-subtitle")}
        primaryCta={{ label: t("cta-primary"), href: "/auth/sign-up" }}
        secondaryCta={{ label: t("hero-secondary"), href: "/pricing" }}
        media={
          <ProductComposition
            frame={
              <ProductFrame glow>
                <DataVizPlaceholder label={t("hero-eyebrow")} />
              </ProductFrame>
            }
            satellites={[
              {
                children: (
                  <KpiChip
                    label={t("chip-kpi-label")}
                    value={t("chip-kpi-value")}
                    delta={t("chip-kpi-delta")}
                    tone="primary"
                  />
                ),
                position: "top-right",
                depth: "front",
                rotate: 3,
                float: true,
              },
              {
                children: <TrendChip label={t("chip-trend-label")} tone="accent-3" />,
                position: "bottom-left",
                depth: "front",
                rotate: -3,
                float: true,
                floatDelay: 0.8,
              },
              {
                children: <ReadoutChip text={t("chip-readout-text")} tone="accent-1" />,
                position: "left",
                depth: "back",
                hideBelow: "md",
              },
            ]}
          />
        }
      />

      <LogoCloud label={t("logos-label")} items={[1, 2, 3, 4, 5].map((index) => ({ name: t(`logo-${index}`) }))} />

      <FeatureRows
        id="features"
        decor="grid"
        eyebrow={t("features-eyebrow")}
        title={t("features-title")}
        subtitle={t("features-subtitle")}
        items={[
          {
            eyebrow: t("row-1-eyebrow"),
            title: t("feature-6-title"),
            body: t("feature-6-description"),
            bullets: [t("row-1-bullet-1"), t("row-1-bullet-2"), t("row-1-bullet-3")],
            media: (
              <ProductFrame>
                <DataVizPlaceholder label={t("row-1-eyebrow")} />
              </ProductFrame>
            ),
            tone: "primary",
          },
          {
            eyebrow: t("row-2-eyebrow"),
            title: t("feature-2-title"),
            body: t("feature-2-description"),
            bullets: [t("row-2-bullet-1"), t("row-2-bullet-2"), t("row-2-bullet-3")],
            media: <ProductFrame />,
            tone: "secondary",
          },
        ]}
      />

      {/* The page's one full-bleed breakout: the control-room console runs off
          the right edge with a quiet parallax; copy stays in the container. */}
      <Section bleed decor="dots" className="overflow-x-clip">
        <Breakout
          side="right"
          media={
            <Parallax speed={8}>
              <ProductFrame>
                <DataVizPlaceholder label={t("breakout-eyebrow")} />
              </ProductFrame>
            </Parallax>
          }
        >
          <p className="text-primary mb-3 text-sm font-semibold tracking-wide uppercase">{t("breakout-eyebrow")}</p>
          <h2 className="font-display text-display-lg text-text-primary font-bold">{t("breakout-title")}</h2>
          <p className="text-text-secondary mt-4 text-lg leading-7">{t("breakout-body")}</p>
          <ul className="mt-6 flex flex-col gap-3">
            {[t("breakout-bullet-1"), t("breakout-bullet-2")].map((bullet) => (
              <li key={bullet} className="text-text-primary flex items-start gap-2.5 leading-6">
                <NiCheck size="small" className="text-primary mt-0.5 flex-none" />
                {bullet}
              </li>
            ))}
          </ul>
        </Breakout>
      </Section>

      <BentoGrid
        decor="mesh"
        eyebrow={t("bento-eyebrow")}
        title={t("bento-title")}
        items={[
          {
            title: t("feature-3-title"),
            body: t("feature-3-description"),
            visual: <NiCreditCard className="h-10 w-10" />,
            featured: true,
            tone: "accent-3",
          },
          {
            title: t("feature-4-title"),
            body: t("feature-4-description"),
            visual: <NiShieldCheck className="h-10 w-10" />,
            tone: "accent-1",
          },
          {
            title: t("feature-5-title"),
            body: t("feature-5-description"),
            visual: <NiAi className="h-10 w-10" />,
            featured: true,
            tone: "accent-4",
          },
          {
            title: t("feature-1-title"),
            body: t("feature-1-description"),
            visual: <NiFlash className="h-10 w-10" />,
            tone: "accent-2",
          },
        ]}
      />

      <StatBand
        stats={[
          { value: t("stats-1-value"), label: t("stats-1-label"), tone: "accent-2" },
          { value: t("stats-2-value"), label: t("stats-2-label"), tone: "accent-3" },
          { value: t("stats-3-value"), label: t("stats-3-label"), tone: "accent-1" },
          { value: t("stats-4-value"), label: t("stats-4-label"), tone: "secondary" },
        ]}
      />

      <Testimonials
        eyebrow={t("testimonials-eyebrow")}
        title={t("testimonials-title")}
        items={[1, 2, 3].map((index) => ({
          quote: t(`testimonial-${index}-quote`),
          name: t(`testimonial-${index}-name`),
          role: t(`testimonial-${index}-role`),
        }))}
      />

      <PricingSection
        id="pricing"
        eyebrow={t("pricing-eyebrow")}
        title={t("pricing-title")}
        subtitle={t("pricing-subtitle")}
        plans={plans}
        ctaLabel={t("cta-primary")}
      />

      <Faq
        eyebrow={t("faq-eyebrow")}
        title={t("faq-title")}
        items={[1, 2, 3, 4].map((index) => ({
          question: t(`faq-${index}-question`),
          answer: t(`faq-${index}-answer`),
        }))}
      />

      <Cta
        kicker={t("cta-kicker")}
        decor="orbit"
        title={t("cta-title")}
        subtitle={t("cta-subtitle")}
        cta={{ label: t("cta-primary"), href: "/auth/sign-up" }}
      />
    </>
  );
}
