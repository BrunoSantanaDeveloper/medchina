"use client";
import Link from "next/link";

import { Button } from "@mui/material";

import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import NiCheck from "@/icons/nexture/ni-check";

/**
 * Funnel stage: recovery — the last conversion opportunity on the page.
 * Two treatments:
 * - "panel" (default): bordered console panel with a primary glow.
 * - "deep" (blueprint §25): full-bleed deep teal band with the orbit ambient,
 *   light CTA button, optional demo link and reassurance points.
 * The button label must repeat the page's final CTA verbatim.
 */
export default function Cta({
  title,
  subtitle,
  cta,
  secondaryCta,
  points,
  kicker,
  decor = "none",
  variant = "panel",
}: {
  title: string;
  subtitle?: string;
  cta: { label: string; href: string };
  /** Deep variant only: subordinate text link beside the button ("Ver demonstração"). */
  secondaryCta?: { label: string; href: string };
  /** Deep variant only: short risk-reducing reassurances under the actions. */
  points?: string[];
  /** Optional mono kicker above the title (e.g. "next step"). */
  kicker?: string;
  /** Ambient layer on the surrounding Section (orbit is the classic closer). */
  decor?: "none" | "orbit" | "mesh" | "dots";
  variant?: "panel" | "deep";
}) {
  if (variant === "deep") {
    return (
      <Section background="deep" decor={decor}>
        <Reveal>
          <div className="flex flex-col items-start gap-4 py-6 md:py-10">
            {kicker && <p className="text-secondary-light font-mono text-xs tracking-widest uppercase">{kicker}</p>}
            <h2 className="font-display text-display-lg max-w-3xl font-bold">{title}</h2>
            {subtitle && <p className="text-text-contrast/75 max-w-2xl text-lg leading-7">{subtitle}</p>}
            <div className="mt-2 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              {/* Light button on the deep band (blueprint §25): token classes override
                  the contained-primary look — white surface, deep teal label. */}
              <Button
                size="large"
                variant="contained"
                color="primary"
                href={cta.href}
                LinkComponent={Link}
                className="bg-text-contrast! text-primary-dark! shadow-darker-sm hover:bg-text-contrast/90!"
              >
                {cta.label}
              </Button>
              {secondaryCta && (
                <Link
                  href={secondaryCta.href}
                  className="text-text-contrast/85 border-text-contrast/40 hover:border-text-contrast border-b pb-0.5 text-sm font-semibold transition-colors"
                >
                  {secondaryCta.label}
                </Link>
              )}
            </div>
            {points && points.length > 0 && (
              <ul className="border-text-contrast/15 mt-4 flex w-full max-w-3xl flex-wrap gap-x-7 gap-y-2.5 border-t pt-5">
                {points.map((point) => (
                  <li key={point} className="text-text-contrast/70 flex items-center gap-1.5 text-sm">
                    <NiCheck size="small" className="text-secondary-light flex-none" />
                    {point}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Reveal>
      </Section>
    );
  }

  return (
    <Section decor={decor}>
      <Reveal>
        <div className="border-grey-100 bg-background-paper relative overflow-hidden rounded-4xl border px-6 py-16 text-center md:py-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: "radial-gradient(ellipse 60% 80% at 50% 0%, hsl(var(--primary) / 0.12), transparent 70%)",
            }}
          />
          <div className="relative flex flex-col items-center gap-4">
            {kicker && <p className="text-primary font-mono text-xs tracking-widest uppercase">{kicker}</p>}
            <h2 className="font-display text-display-lg text-text-primary max-w-2xl font-bold">{title}</h2>
            {subtitle && <p className="text-text-secondary max-w-xl text-lg leading-6">{subtitle}</p>}
            <Button
              size="large"
              variant="contained"
              color="primary"
              href={cta.href}
              LinkComponent={Link}
              className="mt-2"
            >
              {cta.label}
            </Button>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
