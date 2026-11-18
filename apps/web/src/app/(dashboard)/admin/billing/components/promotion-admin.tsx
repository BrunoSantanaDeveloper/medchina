"use client";

import { Field, RowLine, RowText, SelectField } from "./catalog-shared";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Checkbox, Chip, FormControlLabel } from "@mui/material";

import { recordAudit } from "@/lib/audit";
import { ladderFacts, ladderLinesPtBR } from "@/lib/price-ladder";
import { PROMOTION_KEY, type PromotionSetting, resolvePromotion } from "@/lib/promotion";
import { createClient } from "@flyee/auth/client";
import { parsePricePhases } from "@flyee/billing/types";

type PromotionConfig = {
  enabled: boolean;
  label: string;
  plan_slug: string;
  compare_plan_slug: string;
  show_on_home: boolean;
  /** ISO strings, or "". */
  starts_at: string;
  ends_at: string;
};

type PlanRow = {
  slug: string;
  name: string;
  period: string | null;
  price_cents: number;
  is_active: boolean;
  is_free: boolean;
  is_addon: boolean;
  price_phases: unknown;
};

const EMPTY: PromotionConfig = {
  enabled: false,
  label: "",
  plan_slug: "",
  compare_plan_slug: "",
  show_on_home: false,
  starts_at: "",
  ends_at: "",
};

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time; the setting stores ISO. */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const PER: Record<string, string> = { monthly: "/mês", yearly: "/ano", weekly: "/semana" };

/**
 * The catalogue as choices: paid, active, sellable plans, each with its price
 * and whether it has a ladder — so the operator picks a ROW instead of typing
 * a slug (a page slug and a price typed here made the promotion silently sell
 * nothing). A saved value that names no plan stays visible, marked, so the
 * mistake is seen rather than replaced.
 */
function planOptions(plans: PlanRow[], current: string, emptyLabel: string) {
  const sellable = plans.filter((row) => row.is_active && !row.is_free && !row.is_addon);
  const options = [
    { value: "", label: emptyLabel },
    ...sellable.map((row) => ({
      value: row.slug,
      label: `${row.name} · ${row.slug} · ${BRL.format(row.price_cents / 100)}${
        row.period ? (PER[row.period] ?? "") : ""
      }${parsePricePhases(row.price_phases) ? " · preço em fases" : ""}`,
    })),
  ];
  if (current && !sellable.some((row) => row.slug === current)) {
    options.push({ value: current, label: `${current} — não é um plano ativo, escolha outro` });
  }
  return options;
}

const brasilia = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

/**
 * The dated promotion (migration 0126): the Black Friday today, the next
 * dated promotion tomorrow with other dates.
 *
 * Separate from the campaign card on purpose — the campaign keeps selling on
 * /assinar while a promotion runs on /black-friday, and comes back to the home
 * by itself when the promotion closes.
 *
 * The window is the part that has to be true: the page prints it, the counter
 * stops at it and `startCheckout` refuses the plan outside it, all from this
 * row. The PRICES are not here: they live on the plan line, including its
 * ladder (`plans.price_phases`), shown below read-only so the operator sees
 * exactly what the pages will print before saving.
 */
export default function PromotionAdmin() {
  const [config, setConfig] = useState<PromotionConfig>(EMPTY);
  const [rawValue, setRawValue] = useState<Record<string, unknown>>({});
  const [plans, setPlans] = useState<PlanRow[]>([]);
  // A failed read is NOT an empty catalogue: shown as "no plan with that slug"
  // it sends the operator hunting for a typo when the cause is elsewhere (for
  // instance a database without migration 0126, where `price_phases` does not
  // exist and the whole select fails).
  const [planError, setPlanError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data: setting }, { data: planRows, error: planReadError }] = await Promise.all([
      supabase.from("platform_settings").select("value").eq("key", PROMOTION_KEY).maybeSingle(),
      supabase
        .from("plans")
        .select("slug, name, period, price_cents, is_active, is_free, is_addon, price_phases")
        .order("price_cents", { ascending: true }),
    ]);
    setPlanError(planReadError ? planReadError.message : null);
    const value = (setting?.value ?? {}) as PromotionSetting;
    setRawValue((setting?.value ?? {}) as Record<string, unknown>);
    setConfig({
      enabled: value.enabled === true,
      label: typeof value.label === "string" ? value.label : "",
      plan_slug: typeof value.plan_slug === "string" ? value.plan_slug : "",
      compare_plan_slug: typeof value.compare_plan_slug === "string" ? value.compare_plan_slug : "",
      show_on_home: value.show_on_home === true,
      starts_at: typeof value.starts_at === "string" ? value.starts_at : "",
      ends_at: typeof value.ends_at === "string" ? value.ends_at : "",
    });
    setPlans((planRows as PlanRow[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    setError(null);
    setSaved(false);
    // The two plan fields name catalogue rows, and a value that names nothing
    // fails silently on the public pages (the page just shows "closed"). So the
    // form refuses it here, where the operator can still fix it.
    const chosen = plans.find((row) => row.slug === config.plan_slug.trim());
    if (!chosen || !chosen.is_active || chosen.is_free) {
      setError("Escolha na lista o plano pago e ativo que a promoção vende.");
      return;
    }
    if (config.compare_plan_slug.trim() && !plans.some((row) => row.slug === config.compare_plan_slug.trim())) {
      setError("O plano de âncora tem que ser um plano da lista (ou Nenhum).");
      return;
    }
    const supabase = createClient();
    const next = {
      enabled: config.enabled,
      label: config.label.trim() || null,
      plan_slug: config.plan_slug.trim(),
      compare_plan_slug: config.compare_plan_slug.trim(),
      show_on_home: config.show_on_home,
      starts_at: config.starts_at || null,
      ends_at: config.ends_at || null,
    };
    // Merge, never replace: this form does not own every key of the row.
    const { error: saveError } = await supabase
      .from("platform_settings")
      .upsert({ key: PROMOTION_KEY, value: { ...rawValue, ...next } });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    recordAudit(supabase, "admin.billing.promotion.updated", { entityType: "platform_setting", metadata: next });
    setSaved(true);
    refresh();
  };

  if (loading) return null;

  const state = resolvePromotion({
    enabled: config.enabled,
    label: config.label,
    plan_slug: config.plan_slug,
    compare_plan_slug: config.compare_plan_slug,
    show_on_home: config.show_on_home,
    starts_at: config.starts_at || null,
    ends_at: config.ends_at || null,
  });
  const plan = plans.find((row) => row.slug === config.plan_slug.trim()) ?? null;
  const anchor = plans.find((row) => row.slug === config.compare_plan_slug.trim()) ?? null;
  const ladder = plan
    ? ladderLinesPtBR(
        ladderFacts(
          { priceCents: plan.price_cents, period: plan.period, pricePhases: parsePricePhases(plan.price_phases) },
          anchor ? { name: anchor.name, period: anchor.period, priceCents: anchor.price_cents } : null,
        ),
        plan.period,
      )
    : [];

  // "Selling" needs BOTH the window and a plan the checkout can sell — the same
  // two conditions the page and the home check (`resolveSellablePromotion`).
  const sellablePlan = Boolean(plan && plan.is_active && !plan.is_free);
  const selling = !state.closed && sellablePlan;
  const statusLine =
    !state.closed && !sellablePlan
      ? "A janela está aberta, mas o plano escolhido não existe ou está inativo: a página mostra o estado fechado e a home não muda."
      : state.reason === "not_configured"
        ? "Informe o plano e o fim da promoção (o início é opcional, e precisa ser antes do fim)."
        : state.reason === "disabled"
          ? "A promoção existe, mas está desligada: /black-friday mostra o estado fechado."
          : state.reason === "not_started"
            ? `Abre em ${brasilia(state.startsAt)} (Brasília). Até lá, o checkout recusa o plano.`
            : state.reason === "expired"
              ? "O prazo terminou: o checkout recusa o plano e a home voltou ao normal."
              : `Vendendo até ${brasilia(state.endsAt)} (Brasília).`;

  return (
    <Box className="flex flex-col gap-4">
      <RowLine>
        <RowText
          primary={selling ? "/black-friday está vendendo" : "/black-friday mostra o estado fechado"}
          secondary={statusLine}
        />
        <Chip
          label={selling ? "aberta" : state.closed ? state.reason : "sem plano"}
          size="small"
          color={selling ? "success" : "grey"}
          variant="outlined"
        />
      </RowLine>

      <RowLine>
        <RowText
          primary={
            plan
              ? `${plan.name} · ${plan.slug}${plan.is_active ? "" : " (inativo)"}`
              : config.plan_slug.trim()
                ? `Não existe plano "${config.plan_slug.trim()}"`
                : "Nenhum plano escolhido"
          }
          secondary={
            plan ? ladder.join(" · ") : "Escolha o plano na lista abaixo: a página e a home só vendem um plano ativo."
          }
        />
        <Chip
          label={plan && parsePricePhases(plan.price_phases) ? "preço em fases" : "preço único"}
          size="small"
          color="grey"
          variant="outlined"
        />
      </RowLine>

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={config.enabled}
            onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
          />
        }
        label="Promoção ligada (desmarque para fechar antes do prazo — NÃO desative o plano)"
      />
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={config.show_on_home}
            onChange={(event) => setConfig({ ...config, show_on_home: event.target.checked })}
          />
        }
        label="A home mostra a faixa e o cartão da promoção enquanto ela estiver aberta"
      />
      <Field
        label="Nome do evento, como as páginas escrevem (ex.: Black Friday)"
        value={config.label}
        onChange={(value) => setConfig({ ...config, label: value })}
      />
      {planError ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          Não consegui ler os planos: {planError}
          {planError.includes("price_phases")
            ? " — a coluna price_phases não existe neste banco: a migração 0126 ainda não foi aplicada aqui."
            : ""}
        </Alert>
      ) : null}
      <SelectField
        label="Plano que a promoção vende"
        value={config.plan_slug.trim()}
        options={planOptions(plans, config.plan_slug.trim(), "Escolha um plano")}
        onChange={(value) => setConfig({ ...config, plan_slug: value })}
      />
      <SelectField
        label="Plano de âncora (o preço de tabela que aparece riscado)"
        value={config.compare_plan_slug.trim()}
        options={planOptions(plans, config.compare_plan_slug.trim(), "Nenhum (sem preço riscado)")}
        onChange={(value) => setConfig({ ...config, compare_plan_slug: value })}
      />
      <Field
        label="Início no fuso do SEU navegador (vazio = já aberta); as páginas mostram em horário de Brasília"
        type="datetime-local"
        value={toLocalInput(config.starts_at)}
        onChange={(value) => setConfig({ ...config, starts_at: value ? new Date(value).toISOString() : "" })}
      />
      <Field
        label="Fim no fuso do SEU navegador (obrigatório: promoção sem fim não abre)"
        type="datetime-local"
        value={toLocalInput(config.ends_at)}
        onChange={(value) => setConfig({ ...config, ends_at: value ? new Date(value).toISOString() : "" })}
      />

      <Box>
        <Button variant="contained" onClick={save}>
          Salvar promoção
        </Button>
      </Box>

      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          Salvo. A página, a home e a trava do checkout seguem isso na hora.
        </Alert>
      )}
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}
    </Box>
  );
}
