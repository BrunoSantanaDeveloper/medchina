"use client";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";

import { cn } from "@/lib/utils";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Scroll reveal for marketing sections — the ONLY sanctioned way to animate
 * content into view. Rules baked in (do not bypass):
 * - transforms + autoAlpha only (compositor-friendly, no layout thrash);
 * - plays once, near-viewport trigger;
 * - `prefers-reduced-motion: reduce` renders everything static and visible;
 * - distance/duration come from the marketing motion tokens.
 */
export default function Reveal({
  children,
  className,
  stagger = 0,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** Seconds between children; 0 animates the wrapper as a single block. */
  stagger?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const element = ref.current;
      if (!element) return;

      const rootStyles = getComputedStyle(document.documentElement);
      const distance = rootStyles.getPropertyValue("--motion-reveal-distance").trim() || "2.5rem";
      const durationMs = parseFloat(rootStyles.getPropertyValue("--motion-duration-3")) || 800;

      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(stagger > 0 ? Array.from(element.children) : element, {
          y: distance,
          autoAlpha: 0,
          duration: durationMs / 1000,
          ease: "power3.out",
          delay,
          stagger,
          scrollTrigger: {
            trigger: element,
            start: "top 85%",
            once: true,
          },
        });
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={cn(className)}>
      {children}
    </div>
  );
}
