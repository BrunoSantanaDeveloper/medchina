import { type PricePhase, priceSchedule, scheduleTotalCents } from "@flyee/billing/types";

/**
 * Everything a page says about a plan sold with a price ladder (migration
 * 0126), computed once from the plan rows.
 *
 * The rule this module exists for: every number on an offer page closes with
 * the prices on the same page (CDC art. 37 §1). The selo, the struck price, the
 * first-year total and the saving are derived here from the plan and its
 * anchor, and the surfaces only format them — none of them can do its own
 * arithmetic and disagree with the others, or with what the webhook charges.
 */
export type LadderPlan = { priceCents: number; period: string | null; pricePhases: PricePhase[] | null };
export type AnchorPlan = { priceCents: number; period: string | null; name: string };

export type LadderFacts = {
  schedule: { fromCycle: number; toCycle: number | null; priceCents: number }[];
  /** What the first cycle costs — what she pays today. */
  firstPriceCents: number;
  /** How many cycles the first price lasts, or null for a single price. */
  introCycles: number | null;
  /** The anchor's price, only when it bills by the same period. */
  anchorCents: number | null;
  anchorName: string | null;
  /**
   * The deepest discount against the anchor, in whole percent ROUNDED DOWN.
   * Down, never to the nearest: 66.9% printed as 67% would overstate the offer.
   */
  maxDiscountPercent: number | null;
  /** First year of the ladder vs. twelve anchor cycles (monthly plans only). */
  firstYearCents: number | null;
  anchorYearCents: number | null;
  firstYearSavingsCents: number | null;
  /** True when the open-ended last stretch IS the anchor price ("volta ao preço de tabela"). */
  endsAtAnchor: boolean;
};

const CYCLES_PER_YEAR: Record<string, number> = { monthly: 12, weekly: 52, yearly: 1 };

export function ladderFacts(plan: LadderPlan, anchor: AnchorPlan | null): LadderFacts {
  const schedule = priceSchedule(plan.priceCents, plan.pricePhases);
  const anchorCents = anchor && anchor.period === plan.period && anchor.priceCents > 0 ? anchor.priceCents : null;
  const lowest = Math.min(...schedule.map((stretch) => stretch.priceCents));
  const maxDiscountPercent =
    anchorCents && anchorCents > lowest ? Math.floor(((anchorCents - lowest) / anchorCents) * 100) : null;

  const yearCycles = plan.period ? (CYCLES_PER_YEAR[plan.period] ?? null) : null;
  const firstYearCents =
    yearCycles && plan.period === "monthly" ? scheduleTotalCents(plan.priceCents, plan.pricePhases, yearCycles) : null;
  const anchorYearCents = firstYearCents !== null && anchorCents ? anchorCents * 12 : null;
  const firstYearSavingsCents =
    firstYearCents !== null && anchorYearCents !== null && anchorYearCents > firstYearCents
      ? anchorYearCents - firstYearCents
      : null;

  const last = schedule[schedule.length - 1];
  return {
    schedule,
    firstPriceCents: plan.priceCents,
    introCycles: schedule.length > 1 ? (schedule[0].toCycle ?? null) : null,
    anchorCents,
    anchorName: anchorCents ? (anchor?.name ?? null) : null,
    maxDiscountPercent,
    firstYearCents,
    anchorYearCents,
    firstYearSavingsCents,
    endsAtAnchor: anchorCents !== null && schedule.length > 1 && last.priceCents === anchorCents,
  };
}

/** The money format of the offer pages: "R$ 99", "R$ 2.070" — never "R$ 99,00". */
export const BRL_WHOLE = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const UNIT: Record<string, { one: string; per: string }> = {
  monthly: { one: "mês", per: "por mês" },
  weekly: { one: "semana", per: "por semana" },
  yearly: { one: "ano", per: "por ano" },
};

/**
 * The ladder as lines, for a summary box: "Do 1º ao 3º mês: R$ 99 por mês".
 * pt-BR, like every funnel surface (the home builds its own from its catalogs).
 */
export function ladderLinesPtBR(facts: LadderFacts, period: string | null, money = BRL_WHOLE): string[] {
  const unit = UNIT[period ?? ""] ?? { one: "ciclo", per: "por ciclo" };
  return facts.schedule.map((stretch) => {
    const price = `${money.format(stretch.priceCents / 100)} ${unit.per}`;
    if (stretch.toCycle === null) {
      const tail = facts.endsAtAnchor && facts.anchorName ? `, o preço de tabela do ${facts.anchorName}` : "";
      return `Do ${stretch.fromCycle}º ${unit.one} em diante: ${price}${tail}`;
    }
    return stretch.fromCycle === stretch.toCycle
      ? `No ${stretch.fromCycle}º ${unit.one}: ${price}`
      : `Do ${stretch.fromCycle}º ao ${stretch.toCycle}º ${unit.one}: ${price}`;
  });
}

/**
 * The whole condition in one sentence, for the line under a buy button:
 * "Hoje você paga R$ 99. Depois, R$ 99 por mês até o 3º mês, R$ 197 por mês
 * do 4º ao 12º e R$ 299 por mês do 13º em diante, o preço de tabela do Pro."
 */
export function ladderSentencePtBR(facts: LadderFacts, period: string | null, money = BRL_WHOLE): string {
  const unit = UNIT[period ?? ""] ?? { one: "ciclo", per: "por ciclo" };
  const today = `Hoje você paga ${money.format(facts.firstPriceCents / 100)}.`;
  if (facts.schedule.length === 1)
    return `${today} A assinatura renova ${unit.per === "por mês" ? "todo mês" : unit.per} pelo mesmo valor.`;

  const parts = facts.schedule.map((stretch, index) => {
    const price = `${money.format(stretch.priceCents / 100)} ${unit.per}`;
    if (stretch.toCycle === null) {
      const tail = facts.endsAtAnchor && facts.anchorName ? `, o preço de tabela do ${facts.anchorName}` : "";
      return `${price} do ${stretch.fromCycle}º em diante${tail}`;
    }
    if (index === 0) return `${price} até o ${stretch.toCycle}º ${unit.one}`;
    return stretch.fromCycle === stretch.toCycle
      ? `${price} no ${stretch.fromCycle}º`
      : `${price} do ${stretch.fromCycle}º ao ${stretch.toCycle}º`;
  });
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}` : parts[0];
  return `${today} Depois, ${joined}.`;
}
