"use client";

import { RowLine, RowText } from "./catalog-shared";

import { Alert } from "@mui/material";

export type OfferPlanRow = {
  slug: string;
  name: string;
  period: string | null;
  price_cents: number;
  is_active: boolean;
  limits: Record<string, number> | null;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const PERIOD_WORD: Record<string, string> = { yearly: "ano", monthly: "mês", weekly: "semana" };

/**
 * What the visitor will actually SEE, resolved from the same plan rows the
 * landing page reads.
 *
 * Every offer console needs this and none of them should compute it twice: a
 * console that only writes settings hides its own typos, and the two failures
 * it hides are silent by nature — an anchor that never renders (wrong slug,
 * inactive plan, a price below the offer's) and an audio quota copied from a
 * monthly plan onto a yearly line, which delivers one twelfth of what the page
 * promises.
 */
export default function OfferPreview({
  plans,
  planSlug,
  compareSlug,
  label,
}: {
  plans: OfferPlanRow[];
  planSlug: string;
  compareSlug: string;
  /** Where these numbers show up, for the operator reading the line. */
  label: string;
}) {
  const plan = plans.find((row) => row.slug === planSlug.trim()) ?? null;
  const comparePlan = compareSlug.trim() ? (plans.find((row) => row.slug === compareSlug.trim()) ?? null) : null;

  // Mirrors the page exactly: a monthly anchor is annualized, a period mismatch
  // yields no anchor, and an anchor cheaper than the offer is dropped.
  const anchorCents =
    comparePlan && plan
      ? comparePlan.period === "monthly" && plan.period === "yearly"
        ? comparePlan.price_cents * 12
        : comparePlan.period === plan.period
          ? comparePlan.price_cents
          : 0
      : 0;
  const anchorRenders = Boolean(plan && comparePlan?.is_active && anchorCents > plan.price_cents);

  const minutes = Number(plan?.limits?.audio_minutes ?? 0);
  const proMinutes = Number(plans.find((row) => row.slug === "pro")?.limits?.audio_minutes ?? 0);
  const minutesLookShort = plan?.period === "yearly" && proMinutes > 0 && minutes > 0 && minutes < proMinutes * 12;

  if (!plan) {
    return (
      <RowLine>
        <RowText
          primary={
            planSlug.trim() ? `Plano "${planSlug.trim()}" não encontrado no catálogo` : "Nenhum plano selecionado"
          }
          secondary={`${label} mostra o estado fechado até um plano ativo ser informado aqui.`}
        />
      </RowLine>
    );
  }

  const periodWord = plan.period ? (PERIOD_WORD[plan.period] ?? "ciclo") : "ciclo";

  return (
    <>
      <RowLine>
        <RowText
          primary={`${label} mostra ${BRL.format(plan.price_cents / 100)} por ${periodWord}${
            anchorRenders ? ` · riscado ${BRL.format(anchorCents / 100)}` : " · SEM preço riscado"
          }`}
          secondary={`Cota de áudio ${minutes} min por ${periodWord}${
            anchorRenders
              ? ""
              : comparePlan
                ? ` · a âncora "${comparePlan.slug}" não aparece (inativa, mais barata que a oferta, ou período incomparável)`
                : " · nenhum plano de âncora definido"
          }${plan.is_active ? "" : " · O PLANO ESTÁ INATIVO e não pode ser comprado"}`}
        />
      </RowLine>
      {minutesLookShort && (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          A cota de áudio vale por UM CICLO DE COBRANÇA, e este plano cobra por ano — então {minutes} min é o ano
          inteiro, enquanto o Pro mensal dá {proMinutes} min por mês ({proMinutes * 12} por ano). Se esta oferta é
          vendida como o Pro completo, ajuste audio_minutes para {proMinutes * 12} na aba Planos.
        </Alert>
      )}
    </>
  );
}
