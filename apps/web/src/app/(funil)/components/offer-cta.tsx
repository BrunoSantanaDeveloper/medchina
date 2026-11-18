"use client";

import { type ReactNode, useEffect, useState } from "react";

import { track } from "@/lib/analytics";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

/**
 * The buy button of an offer page, with the POSITION it sits in.
 *
 * The same button appears in the hero, in the price section, in the sticky bar
 * and in the final call; each carries its own position so the results can say
 * which one sells (`cta_click`, docs of the conversion-pages skill: one id per
 * call position). The label is the same everywhere on purpose.
 */
export function OfferCta({
  href,
  label,
  position,
  page,
  className = "button",
}: {
  href: string;
  label: string;
  position: "hero" | "condicao" | "barra" | "final" | "meio";
  page: string;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={href}
      data-cta={position}
      onClick={() => track("cta_click", { content_name: page, position })}
    >
      {label} <ArrowRight size={18} aria-hidden="true" />
    </a>
  );
}

/**
 * The price and the button, pinned to the bottom of the screen once the
 * hero's offer box has scrolled out of sight — and gone again when the final
 * call is on screen, where the same button already is.
 *
 * It carries the short condition, not only the price ("R$ 99/mês nos 3
 * primeiros meses"): a sticky "R$ 99" with no qualifier would be the one place
 * on the page where the price reads as permanent.
 */
export function OfferStickyBar({
  watchId,
  hideOnId,
  children,
}: {
  /** The element whose exit shows the bar (the hero offer box). */
  watchId: string;
  /** The element whose entry hides it again (the final call). */
  hideOnId?: string;
  children: ReactNode;
}) {
  const [pastOffer, setPastOffer] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const watched = document.getElementById(watchId);
    const end = hideOnId ? document.getElementById(hideOnId) : null;
    if (!watched) return;
    const offerObserver = new IntersectionObserver(([entry]) => {
      // Shown only once the box has left through the TOP: above it, she has
      // not reached the offer yet and the hero is still what she reads.
      setPastOffer(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    offerObserver.observe(watched);
    const endObserver = end ? new IntersectionObserver(([entry]) => setAtEnd(entry.isIntersecting)) : null;
    if (end && endObserver) endObserver.observe(end);
    return () => {
      offerObserver.disconnect();
      endObserver?.disconnect();
    };
  }, [watchId, hideOnId]);

  const visible = pastOffer && !atEnd;
  return (
    <div className={`bf-sticky ${visible ? "is-visible" : ""}`} aria-hidden={!visible} inert={!visible}>
      <div className="bf-sticky-inner">{children}</div>
    </div>
  );
}
