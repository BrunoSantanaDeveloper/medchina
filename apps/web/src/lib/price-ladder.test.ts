import { ladderFacts, ladderLinesPtBR, ladderSentencePtBR } from "./price-ladder";
import { resolvePromotion } from "./promotion";
import { describe, expect, it } from "vitest";

import { parsePricePhases, pricePhaseAfter, priceSchedule, scheduleTotalCents } from "@flyee/billing/types";

/**
 * The Black Friday 2026 ladder, as migration 0126 seeds it: R$ 99 for three
 * cycles, R$ 197 up to the 12th, then the Pro table price (R$ 299).
 */
const BLACK = parsePricePhases([
  { after_cycles: 3, price_cents: 19700 },
  { after_cycles: 12, price_cents: 29900 },
]);
const PLAN = { priceCents: 9900, period: "monthly", pricePhases: BLACK };
const PRO = { priceCents: 29900, period: "monthly", name: "Pro" };

describe("price ladder arithmetic", () => {
  it("reads the stored ladder and refuses one out of order", () => {
    expect(BLACK).toEqual([
      { afterCycles: 3, priceCents: 19700 },
      { afterCycles: 12, priceCents: 29900 },
    ]);
    expect(
      parsePricePhases([
        { after_cycles: 12, price_cents: 1 },
        { after_cycles: 3, price_cents: 2 },
      ]),
    ).toBeNull();
    expect(parsePricePhases([])).toBeNull();
    expect(parsePricePhases(null)).toBeNull();
  });

  it("moves the price only once the paid count reaches a step", () => {
    // What the webhook asks after each paid invoice.
    expect(pricePhaseAfter(9900, BLACK, 1)).toEqual({ index: 0, priceCents: 9900 });
    expect(pricePhaseAfter(9900, BLACK, 2)).toEqual({ index: 0, priceCents: 9900 });
    expect(pricePhaseAfter(9900, BLACK, 3)).toEqual({ index: 1, priceCents: 19700 });
    expect(pricePhaseAfter(9900, BLACK, 11)).toEqual({ index: 1, priceCents: 19700 });
    expect(pricePhaseAfter(9900, BLACK, 12)).toEqual({ index: 2, priceCents: 29900 });
    expect(pricePhaseAfter(9900, BLACK, 40)).toEqual({ index: 2, priceCents: 29900 });
  });

  it("charges each cycle what the schedule says", () => {
    expect(priceSchedule(9900, BLACK)).toEqual([
      { fromCycle: 1, toCycle: 3, priceCents: 9900 },
      { fromCycle: 4, toCycle: 12, priceCents: 19700 },
      { fromCycle: 13, toCycle: null, priceCents: 29900 },
    ]);
    // 3 × 99 + 9 × 197 = 297 + 1.773
    expect(scheduleTotalCents(9900, BLACK, 12)).toBe(207000);
  });
});

describe("ladderFacts", () => {
  const facts = ladderFacts(PLAN, PRO);

  it("derives every number the page prints from the two plans", () => {
    expect(facts.firstPriceCents).toBe(9900);
    expect(facts.introCycles).toBe(3);
    expect(facts.anchorCents).toBe(29900);
    // (299 − 99) / 299 = 66,9% → 66, never rounded up to 67.
    expect(facts.maxDiscountPercent).toBe(66);
    expect(facts.firstYearCents).toBe(207000);
    expect(facts.anchorYearCents).toBe(358800);
    expect(facts.firstYearSavingsCents).toBe(151800);
    expect(facts.endsAtAnchor).toBe(true);
  });

  it("drops the anchor when the periods cannot be compared", () => {
    const yearly = ladderFacts(PLAN, { ...PRO, period: "yearly" });
    expect(yearly.anchorCents).toBeNull();
    expect(yearly.maxDiscountPercent).toBeNull();
    expect(yearly.firstYearSavingsCents).toBeNull();
  });

  // Intl puts a no-break space after "R$"; the words are what is under test.
  const plain = (text: string) => text.replace(/\u00a0/gu, " ");

  it("says the whole condition in words a buyer reads before paying", () => {
    expect(ladderLinesPtBR(facts, "monthly").map(plain)).toEqual([
      "Do 1º ao 3º mês: R$ 99 por mês",
      "Do 4º ao 12º mês: R$ 197 por mês",
      "Do 13º mês em diante: R$ 299 por mês, o preço de tabela do Pro",
    ]);
    expect(plain(ladderSentencePtBR(facts, "monthly"))).toBe(
      "Hoje você paga R$ 99. Depois, R$ 99 por mês até o 3º mês, R$ 197 por mês do 4º ao 12º e R$ 299 por mês do 13º em diante, o preço de tabela do Pro.",
    );
  });
});

describe("resolvePromotion", () => {
  const BLACK_FRIDAY = {
    enabled: true,
    label: "Black Friday",
    plan_slug: "pro-black",
    compare_plan_slug: "pro",
    starts_at: "2026-11-18T00:00:00-03:00",
    ends_at: "2026-11-27T23:59:59-03:00",
    show_on_home: true,
  };
  const at = (iso: string) => new Date(iso).getTime();

  it("opens at the start and closes after the end, Brasília time", () => {
    expect(resolvePromotion(BLACK_FRIDAY, at("2026-11-17T23:59:59-03:00")).reason).toBe("not_started");
    expect(resolvePromotion(BLACK_FRIDAY, at("2026-11-18T00:00:00-03:00")).reason).toBe("open");
    expect(resolvePromotion(BLACK_FRIDAY, at("2026-11-27T23:59:59-03:00")).reason).toBe("open");
    expect(resolvePromotion(BLACK_FRIDAY, at("2026-11-28T00:00:00-03:00")).reason).toBe("expired");
  });

  it("is not configured without an end, so no counter can run without a date", () => {
    const noEnd = { ...BLACK_FRIDAY, ends_at: null };
    expect(resolvePromotion(noEnd, at("2026-11-20T12:00:00-03:00")).reason).toBe("not_configured");
    expect(
      resolvePromotion({ ...BLACK_FRIDAY, starts_at: BLACK_FRIDAY.ends_at }, at("2026-11-20T12:00:00-03:00")).reason,
    ).toBe("not_configured");
  });

  it("closes on the switch even inside the window", () => {
    const off = resolvePromotion({ ...BLACK_FRIDAY, enabled: false }, at("2026-11-20T12:00:00-03:00"));
    expect(off.reason).toBe("disabled");
    expect(off.closed).toBe(true);
  });
});
