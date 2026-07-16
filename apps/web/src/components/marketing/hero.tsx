"use client";
import Link from "next/link";
import { useRef } from "react";

import { Button } from "@mui/material";

import { gsap, readMotionToken, tokenSeconds, useGSAP } from "@/components/marketing/motion";
import Section from "@/components/marketing/section";

export type HeroCta = { label: string; href: string; icon?: React.ReactNode };

/**
 * Funnel stage: attention + value proposition. Above the fold it must answer
 * what the product is, for whom, and the outcome — before any scrolling.
 * `media` is the product-as-proof slot (usually <ProductFrame> with a real
 * screenshot); the primary CTA label is THE conversion action of the page.
 *
 * Entrance is the page's ONE orchestrated motion moment (committed direction):
 * copy staggers in, then the media rises — a load timeline, not a scroll
 * reveal. Reduced motion renders everything static and visible.
 */
export default function Hero({
  eyebrow,
  title,
  subtitle,
  primaryCta,
  secondaryCta,
  note,
  highlights,
  media,
  layout = "center",
  decor = "glow",
}: {
  eyebrow?: string;
  /** Accepts rich content (e.g. t.rich with <em> for the two-tone blueprint headline). */
  title: React.ReactNode;
  subtitle: string;
  primaryCta: HeroCta;
  secondaryCta?: HeroCta;
  /** Risk-reducing microcopy under the CTAs (e.g. "No card required"). */
  note?: string;
  /**
   * Short reassurance chips under the copy (blueprint §10.7 — "Feito para MTC",
   * "IA supervisionada"…). Split layout only; rendered as a hairline-topped row.
   */
  highlights?: string[];
  /** Product evidence. Required in practice — a hero without it fails the premium bar. */
  media?: React.ReactNode;
  /** "center": stacked, media below. "split": copy left, media right (data/product-heavy pages). */
  layout?: "center" | "split";
  decor?: "glow" | "grid" | "none";
}) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const element = scope.current;
      if (!element) return;

      const distance = readMotionToken("--motion-reveal-distance", "2.5rem");
      const duration = tokenSeconds("--motion-duration-3", 0.8);

      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const timeline = gsap.timeline({
          defaults: { y: distance, autoAlpha: 0, duration, ease: "power3.out" },
        });
        timeline.from(element.querySelectorAll("[data-hero-copy] > *"), { stagger: 0.12 });

        // Layered media (<ProductComposition>): frame rises, then satellites
        // pop in staggered. The entrance animates each satellite's positioning
        // wrapper — <Float> inside animates the chip itself, so no collision.
        const frame = element.querySelector("[data-composition-frame]");
        if (frame) {
          timeline.from(frame, {}, "-=0.55");
          const satellites = element.querySelectorAll("[data-composition-satellite]");
          if (satellites.length) {
            const half = (parseFloat(distance) * 16) / 2; // rem → px, half the reveal distance
            timeline.from(satellites, { y: half, autoAlpha: 0, scale: 0.96, stagger: 0.08 }, "-=0.35");
          }
          return;
        }

        const mediaElement = element.querySelector("[data-hero-media]");
        if (mediaElement) timeline.from(mediaElement, {}, "-=0.55");
      });
    },
    { scope },
  );

  const ctas = (
    <div className="flex flex-col items-center gap-2 sm:flex-row">
      <Button size="large" variant="contained" color="primary" href={primaryCta.href} LinkComponent={Link}>
        {primaryCta.label}
      </Button>
      {secondaryCta && (
        <Button
          size="large"
          variant="pastel"
          color="primary"
          href={secondaryCta.href}
          LinkComponent={Link}
          startIcon={secondaryCta.icon}
        >
          {secondaryCta.label}
        </Button>
      )}
    </div>
  );

  const noteLine = note ? <p className="text-text-secondary -mt-2 text-sm">{note}</p> : null;

  if (layout === "split") {
    return (
      <Section spacing="default" decor={decor} className="overflow-hidden">
        {/* 0.84/1.16 = the blueprint's copy/visual ratio (attachment hero). */}
        <div ref={scope} className="grid grid-cols-1 items-center gap-10 md:grid-cols-[0.84fr_1.16fr] md:gap-10">
          <div data-hero-copy className="flex flex-col items-start gap-6 text-left">
            {eyebrow && <p className="text-primary text-sm font-semibold tracking-wide uppercase">{eyebrow}</p>}
            <h1 className="font-display text-display-xl text-text-primary [&_em]:text-primary font-extrabold [&_em]:not-italic">
              {title}
            </h1>
            <p className="text-text-secondary text-lg leading-6 md:text-xl md:leading-7">{subtitle}</p>
            {ctas}
            {noteLine}
            {highlights && highlights.length > 0 && (
              <ul className="border-grey-100 flex w-full flex-wrap gap-x-5 gap-y-2 border-t pt-4">
                {highlights.map((item) => (
                  <li key={item} className="text-text-secondary flex items-center gap-1.5 text-sm font-semibold">
                    <span aria-hidden className="bg-accent-1 h-1.5 w-1.5 flex-none rounded-full" />
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {media && (
            <div data-hero-media className="w-full">
              {media}
            </div>
          )}
        </div>
      </Section>
    );
  }

  return (
    <Section spacing="default" decor={decor} className="overflow-hidden">
      <div ref={scope} className="flex flex-col items-center">
        <div data-hero-copy className="flex flex-col items-center gap-6 text-center">
          {eyebrow && <p className="text-primary text-sm font-semibold tracking-wide uppercase">{eyebrow}</p>}

          <h1 className="font-display text-display-2xl text-text-primary [&_em]:text-primary max-w-4xl font-extrabold [&_em]:not-italic">
            {title}
          </h1>

          <p className="text-text-secondary max-w-2xl text-lg leading-6 md:text-xl md:leading-7">{subtitle}</p>

          {ctas}
          {noteLine}
        </div>

        {media && (
          <div data-hero-media className="mt-14 w-full max-w-4xl">
            {media}
          </div>
        )}
      </div>
    </Section>
  );
}
