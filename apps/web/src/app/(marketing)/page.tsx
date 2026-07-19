import { getDisplayPlans } from "./plans";
import { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { BRAND } from "@/brand";
import AnamnesisDemo from "@/components/marketing/anamnesis-demo";
import Cta from "@/components/marketing/cta";
import Faq from "@/components/marketing/faq";
import FeatureRows from "@/components/marketing/feature-row";
import Hero from "@/components/marketing/hero";
import IndexGrid from "@/components/marketing/index-grid";
import JsonLd from "@/components/marketing/json-ld";
import PricingSection from "@/components/marketing/pricing-section";
import ProductComposition from "@/components/marketing/product-composition";
import ProductFrame from "@/components/marketing/product-frame";
import RuledGrid from "@/components/marketing/ruled-grid";
import { ReadoutChip } from "@/components/marketing/satellite-chips";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import NiArrowHistory from "@/icons/nexture/ni-arrow-history";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiLock from "@/icons/nexture/ni-lock";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPlay from "@/icons/nexture/ni-play";

const IMAGE_ROOT = "/images/marketing/clinical-home";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  return {
    title: { absolute: `${BRAND.name} | ${t("home-meta-title")}` },
    description: t("home-meta-description"),
  };
}

export default async function Home() {
  const [t, plans] = await Promise.all([getTranslations("marketing"), getDisplayPlans()]);
  const stateLabels = {
    clear: t("state-clear"),
    attention: t("state-attention"),
    empty: t("state-empty"),
  };

  return (
    <>
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

      <Hero
        layout="split"
        eyebrow={t("hero-eyebrow")}
        title={t.rich("hero-title", { em: (chunks) => <em>{chunks}</em> })}
        subtitle={t("hero-subtitle")}
        primaryCta={{ label: t("cta-primary"), href: "/auth/sign-up" }}
        secondaryCta={{ label: t("hero-secondary"), href: "#como-funciona", icon: <NiPlay size="small" /> }}
        note={t("hero-note")}
        highlights={[t("hero-highlight-1"), t("hero-highlight-2"), t("hero-highlight-3"), t("hero-highlight-4")]}
        media={
          <ProductComposition
            className="py-5"
            frame={
              <div className="relative aspect-[6/5] overflow-hidden rounded-[2rem]">
                <Image
                  src={`${IMAGE_ROOT}/medchina-hero-product-composite.webp`}
                  alt={t("mock-web-aria")}
                  fill
                  priority
                  sizes="(max-width: 959px) 92vw, 50vw"
                  className="object-contain"
                />
              </div>
            }
            satellites={[
              {
                children: <ReadoutChip text={t("hero-highlight-2")} tone="accent-1" />,
                position: "top-left",
                rotate: -3,
                float: true,
              },
              {
                children: <ReadoutChip text={t("state-hypothesis")} tone="accent-4" />,
                position: "bottom-right",
                rotate: 3,
                float: true,
                floatDelay: 0.7,
              },
              {
                children: <ReadoutChip text={t("hero-highlight-3")} tone="secondary" />,
                position: "right",
                rotate: 2,
                hideBelow: "md",
              },
            ]}
          />
        }
      />

      <Section background="contrast" spacing="compact">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((index) => (
            <div key={index} className="border-grey-100 flex gap-4 border-l pl-4 first:border-l-0 first:pl-0">
              <span className="font-display text-secondary text-2xl font-bold">0{index}</span>
              <div>
                <h2 className="text-text-primary font-bold">{t(`trust-${index}-title`)}</h2>
                <p className="text-text-secondary mt-1 text-sm leading-5">{t(`trust-${index}-body`)}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <FeatureRows
        id="como-funciona"
        eyebrow={t("flow-eyebrow")}
        title={t("flow-title")}
        subtitle={t("flow-subtitle")}
        decor="gradient-edge"
        items={[
          {
            eyebrow: t("wf-1-tab"),
            title: t("flow-1-title"),
            body: t("flow-1-body"),
            tone: "accent-3",
            media: <FlowImage src="medchina-flow-consulta-real.webp" alt={t("wf-consent-title")} />,
          },
          {
            eyebrow: t("wf-2-tab"),
            title: t("flow-2-title"),
            body: t("flow-2-body"),
            tone: "accent-2",
            media: <FlowImage src="medchina-flow-anamnese-real.webp" alt={t("row-anamnese-title")} />,
          },
          {
            eyebrow: t("wf-4-tab"),
            title: t("flow-4-title"),
            body: t("flow-4-body"),
            tone: "accent-4",
            media: <FlowImage src="medchina-flow-plano-real.webp" alt={t("reason-3-title")} />,
          },
        ]}
      />

      <Section background="deep" id="recursos">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <p className="text-secondary-light mb-3 text-sm font-semibold tracking-wide uppercase">
              {t("bento-eyebrow")}
            </p>
            <h2 className="font-display text-display-lg font-bold">{t("bento-title")}</h2>
            <p className="text-text-contrast/75 mt-4 text-lg leading-7">{t("rows-subtitle")}</p>
            <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
              {[1, 2, 3, 4].map((index) => (
                <div key={index} className="border-text-contrast/15 border-t pt-4">
                  <h3 className="font-display text-lg font-bold">{t(`benefit-${index}-title`)}</h3>
                  <p className="text-text-contrast/65 mt-2 text-sm leading-5">{t(`benefit-${index}-body`)}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem]">
            <Image
              src={`${IMAGE_ROOT}/medchina-presence-consultation.webp`}
              alt={t("benefit-1-title")}
              fill
              sizes="(max-width: 1023px) 92vw, 52vw"
              className="object-cover"
            />
            <div className="from-primary-dark/0 to-primary-dark/90 absolute inset-0 bg-gradient-to-b" />
            <div className="absolute right-6 bottom-6 left-6 rounded-2xl border border-white/15 bg-black/20 p-5 backdrop-blur-md">
              <p className="text-secondary-light text-xs font-bold tracking-wider uppercase">{t("reason-safety")}</p>
            </div>
          </div>
        </div>
      </Section>

      <Section id="mobile" background="paper" decor="mesh">
        <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
          <div className="relative aspect-[4/3]">
            <Image
              src={`${IMAGE_ROOT}/medchina-mobile-phones-photo.webp`}
              alt={t("seq-aria")}
              fill
              sizes="(max-width: 767px) 92vw, 48vw"
              className="object-contain"
            />
          </div>
          <div>
            <SectionHeader
              eyebrow={t("mobile-eyebrow")}
              title={t("mobile-title")}
              subtitle={t("mobile-body")}
              align="start"
              className="mb-0"
            />
            <ul className="mt-7 grid gap-3">
              {[1, 2, 3, 4].map((index) => (
                <li key={index} className="text-text-primary flex items-start gap-3 leading-6">
                  <NiDocumentCheck className="text-accent-1 mt-0.5 flex-none" size="small" />
                  {t(`mobile-bullet-${index}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section decor="dots" id="ia-supervisionada">
        <SectionHeader eyebrow={t("rows-eyebrow")} title={t("rows-title")} subtitle={t("rows-subtitle")} />
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

      <Section background="paper">
        <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-16">
          <SectionHeader
            eyebrow={t("mtc-eyebrow")}
            title={t("mtc-title")}
            subtitle={t("mtc-subtitle")}
            align="start"
            className="mb-0"
          />
          <IndexGrid items={Array.from({ length: 16 }, (_, index) => t(`mtc-cat-${index + 1}`))} />
        </div>
      </Section>

      <Section background="deep" id="seguranca">
        <div className="mx-auto mb-12 max-w-3xl text-center">
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
      </Section>

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

      <Faq
        id="duvidas"
        layout="split"
        eyebrow={t("faq-eyebrow")}
        title={t("faq-title")}
        subtitle={t("faq-subtitle")}
        link={{ label: t("cta-primary"), href: "/auth/sign-up" }}
        items={[1, 2, 3, 4, 5, 6, 7].map((index) => ({
          question: t(`faq-${index}-question`),
          answer: t(`faq-${index}-answer`),
        }))}
      />

      <Cta
        variant="deep"
        decor="orbit"
        kicker={t("cta-kicker")}
        title={t("cta-title")}
        subtitle={t("cta-subtitle")}
        cta={{ label: t("cta-final-label"), href: "/auth/sign-up" }}
        secondaryCta={{ label: t("hero-secondary"), href: "#como-funciona" }}
        points={[t("cta-point-1"), t("cta-point-2"), t("cta-point-3"), t("cta-point-4")]}
      />
    </>
  );
}

function FlowImage({ src, alt }: { src: string; alt: string }) {
  return (
    <ProductFrame glow className="overflow-x-clip">
      <div className="relative aspect-[16/10]">
        <Image
          src={`${IMAGE_ROOT}/${src}`}
          alt={alt}
          fill
          sizes="(max-width: 767px) 92vw, 46vw"
          className="object-cover"
        />
      </div>
    </ProductFrame>
  );
}
