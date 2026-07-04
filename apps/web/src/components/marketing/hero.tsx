"use client";
import Link from "next/link";

import { Button } from "@mui/material";

import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";

export type HeroCta = { label: string; href: string };

/**
 * Funnel stage: attention + value proposition. Above the fold it must answer
 * what the product is, for whom, and the outcome — before any scrolling.
 * `media` is the product-as-proof slot (usually <ProductFrame> with a real
 * screenshot); the primary CTA label is THE conversion action of the page.
 */
export default function Hero({
  eyebrow,
  title,
  subtitle,
  primaryCta,
  secondaryCta,
  media,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  primaryCta: HeroCta;
  secondaryCta?: HeroCta;
  media?: React.ReactNode;
}) {
  return (
    <Section spacing="default" className="overflow-hidden">
      <Reveal stagger={0.12} className="flex flex-col items-center gap-6 text-center">
        {eyebrow && <p className="text-primary text-sm font-semibold tracking-wide uppercase">{eyebrow}</p>}

        <h1 className="font-display text-display-2xl text-text-primary max-w-4xl font-extrabold">{title}</h1>

        <p className="text-text-secondary max-w-2xl text-lg leading-6 md:text-xl md:leading-7">{subtitle}</p>

        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <Button size="large" variant="contained" color="primary" href={primaryCta.href} LinkComponent={Link}>
            {primaryCta.label}
          </Button>
          {secondaryCta && (
            <Button size="large" variant="pastel" color="primary" href={secondaryCta.href} LinkComponent={Link}>
              {secondaryCta.label}
            </Button>
          )}
        </div>

        {media && <div className="mt-8 w-full max-w-4xl">{media}</div>}
      </Reveal>
    </Section>
  );
}
