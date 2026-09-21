"use client";

import { useState } from "react";

import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

/**
 * One plan per option, already formatted on the server.
 *
 * Nothing is computed here on purpose. Price arithmetic lives beside the
 * catalogue row that produced it, so the number on screen and the number the
 * checkout charges cannot drift apart through a second implementation.
 */
export type PriceOption = {
  slug: string;
  /** "Mensal" / "Anual" — the tab label, not the plan name. */
  cycleLabel: string;
  /** "R$ 229" */
  price: string;
  /** "por mês" */
  periodSuffix: string;
  /** "R$ 299" when there is a real table price above this one. */
  struck: string | null;
  /** 23 */
  savings: number | null;
  /** "Equivale a R$ 190 por mês, em um pagamento anual único." */
  note: string | null;
  /** "Preço de tabela do Pro: 12 × R$ 299 por mês." */
  anchorNote: string | null;
  /** Short badge on the tab itself: "2 meses grátis". */
  tabBadge: string | null;
  /** Where the CTA goes, already carrying the plan. */
  href: string;
  /** "Assinar o Pro" */
  ctaLabel: string;
};

/**
 * The price block of the campaign landing, when the campaign sells two cycles.
 *
 * Why a switch and not two cards side by side: on a cold-traffic page the
 * visitor has to understand ONE price to decide. Two full price cards make the
 * page a comparison exercise before she knows what the product does, and the
 * monthly figure — the one that removes the barrier — stops being the thing
 * she reads first.
 *
 * So the monthly leads, the annual is one tap away with its saving named on
 * the tab, and only one price is ever on screen. Whoever already wants annual
 * finds it immediately; whoever is deciding is not asked to do arithmetic.
 *
 * Client only for the toggle. Everything it renders was formatted on the
 * server, and with JavaScript unavailable the first option still renders with
 * a working link, because it is the default state of the markup.
 */
export default function OfferPriceChoice({ options }: { options: PriceOption[] }) {
  const [active, setActive] = useState(0);
  if (options.length === 0) return null;
  const current = options[Math.min(active, options.length - 1)];

  return (
    <>
      {options.length > 1 ? (
        <div className="offer-cycle" role="tablist" aria-label="Ciclo de cobrança">
          {options.map((option, index) => (
            <button
              key={option.slug}
              type="button"
              role="tab"
              id={`cycle-tab-${option.slug}`}
              aria-selected={index === active}
              aria-controls="cycle-panel"
              className={index === active ? "offer-cycle-option is-active" : "offer-cycle-option"}
              onClick={() => setActive(index)}
            >
              {option.cycleLabel}
              {option.tabBadge ? <span>{option.tabBadge}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="offer-price" id="cycle-panel" role="tabpanel" aria-labelledby={`cycle-tab-${current.slug}`}>
        {current.struck && current.savings ? (
          <p className="offer-price-was">
            <s>{current.struck}</s>
            <span className="offer-price-badge">{current.savings}% de economia</span>
          </p>
        ) : null}
        <p className="offer-price-now">
          <strong>{current.price}</strong>
          <small>{current.periodSuffix}</small>
        </p>
        {current.note ? <p className="offer-price-note">{current.note}</p> : null}
        {current.anchorNote ? <p className="offer-price-note">{current.anchorNote}</p> : null}
      </div>

      <div className="hero-actions">
        <a className="button" href={current.href}>
          {current.ctaLabel} <ArrowRight size={18} />
        </a>
      </div>
    </>
  );
}
