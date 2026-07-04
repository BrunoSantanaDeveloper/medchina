import { getDisplayPlans } from "./plans";
import { getTranslations } from "next-intl/server";

import Cta from "@/components/marketing/cta";
import Faq from "@/components/marketing/faq";
import FeatureGrid from "@/components/marketing/feature-grid";
import Hero from "@/components/marketing/hero";
import LogoCloud from "@/components/marketing/logo-cloud";
import PricingSection from "@/components/marketing/pricing-section";
import ProductFrame from "@/components/marketing/product-frame";
import Testimonials from "@/components/marketing/testimonials";
import NiAi from "@/icons/nexture/ni-ai";
import NiChartLine from "@/icons/nexture/ni-chart-line";
import NiCreditCard from "@/icons/nexture/ni-credit-card";
import NiFlash from "@/icons/nexture/ni-flash";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiUsers from "@/icons/nexture/ni-users";

const FEATURE_ICONS = [
  <NiFlash key="flash" />,
  <NiUsers key="users" />,
  <NiCreditCard key="credit-card" />,
  <NiShieldCheck key="shield" />,
  <NiAi key="ai" />,
  <NiChartLine key="chart" />,
];

/**
 * Home = conversion funnel: hero (value prop) → logos/testimonials (trust) →
 * features (desire) → pricing (action) → FAQ (objections) → CTA (recovery).
 * The primary CTA label (cta-primary) repeats verbatim at every action point.
 */
export default async function Home() {
  const [t, plans] = await Promise.all([getTranslations("marketing"), getDisplayPlans()]);

  return (
    <>
      <Hero
        eyebrow={t("hero-eyebrow")}
        title={t("hero-title")}
        subtitle={t("hero-subtitle")}
        primaryCta={{ label: t("cta-primary"), href: "/auth/sign-up" }}
        secondaryCta={{ label: t("hero-secondary"), href: "/pricing" }}
        media={<ProductFrame />}
      />

      <LogoCloud label={t("logos-label")} items={[1, 2, 3, 4, 5].map((index) => ({ name: t(`logo-${index}`) }))} />

      <FeatureGrid
        id="features"
        eyebrow={t("features-eyebrow")}
        title={t("features-title")}
        subtitle={t("features-subtitle")}
        features={FEATURE_ICONS.map((icon, index) => ({
          icon,
          title: t(`feature-${index + 1}-title`),
          description: t(`feature-${index + 1}-description`),
        }))}
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
        title={t("cta-title")}
        subtitle={t("cta-subtitle")}
        cta={{ label: t("cta-primary"), href: "/auth/sign-up" }}
      />
    </>
  );
}
