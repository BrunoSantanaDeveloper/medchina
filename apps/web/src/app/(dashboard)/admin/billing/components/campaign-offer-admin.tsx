"use client";

import { Field, RowLine, RowText } from "./catalog-shared";
import OfferPreview, { type OfferPlanRow } from "./offer-preview";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Checkbox, Chip, FormControlLabel } from "@mui/material";

import { recordAudit } from "@/lib/audit";
import { CAMPAIGN_OFFER_KEY, type CampaignOfferSetting, resolveCampaignOffer } from "@/lib/campaign-offer";
import { createClient } from "@flyee/auth/client";

type OfferConfig = {
  enabled: boolean;
  plan_slug: string;
  /** Second price offered beside the first. Empty = one price only. */
  annual_plan_slug: string;
  compare_plan_slug: string;
  /** ISO string, or "" for no deadline. */
  deadline: string;
};

const EMPTY: OfferConfig = {
  enabled: false,
  plan_slug: "",
  annual_plan_slug: "",
  compare_plan_slug: "",
  deadline: "",
};

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time; the setting stores ISO. */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The offer a paid campaign announces on `/assinar`.
 *
 * One plan, one optional anchor, one optional deadline — and nothing else,
 * because everything else a campaign needs is already data: the price and the
 * audio quota come from the plan row, the guarantee from its own setting.
 * Changing what the ads sell is a save here, not a deploy.
 *
 * The deadline is the part that has to be true. The landing page prints it and
 * `startCheckout` refuses the plan after it, from this same row — so the page
 * can never announce a condition the checkout would honour anyway, which is the
 * fake countdown the commercial plan forbids.
 *
 * Discount mechanics, so the next operator does not learn it the expensive way:
 * put the campaign price in a PLAN LINE of its own and point the anchor at the
 * table plan. A coupon is not an alternative — in both providers a coupon
 * discount rides every renewal, so "one month cheaper" silently becomes a lower
 * price forever.
 */
export default function CampaignOfferAdmin() {
  const [config, setConfig] = useState<OfferConfig>(EMPTY);
  const [rawValue, setRawValue] = useState<Record<string, unknown>>({});
  const [plans, setPlans] = useState<OfferPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data: setting }, { data: planRows }] = await Promise.all([
      supabase.from("platform_settings").select("value").eq("key", CAMPAIGN_OFFER_KEY).maybeSingle(),
      supabase.from("plans").select("slug, name, period, price_cents, is_active, limits"),
    ]);
    const value = (setting?.value ?? {}) as CampaignOfferSetting;
    setRawValue((setting?.value ?? {}) as Record<string, unknown>);
    setConfig({
      enabled: value.enabled === true,
      plan_slug: typeof value.plan_slug === "string" ? value.plan_slug : "",
      annual_plan_slug: typeof value.annual_plan_slug === "string" ? value.annual_plan_slug : "",
      compare_plan_slug: typeof value.compare_plan_slug === "string" ? value.compare_plan_slug : "",
      deadline: typeof value.deadline === "string" ? value.deadline : "",
    });
    setPlans((planRows as OfferPlanRow[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const { error: saveError } = await supabase.from("platform_settings").upsert({
      key: CAMPAIGN_OFFER_KEY,
      // Merge, never replace: this form does not own every key of the row.
      value: {
        ...rawValue,
        enabled: config.enabled,
        plan_slug: config.plan_slug.trim(),
        annual_plan_slug: config.annual_plan_slug.trim(),
        compare_plan_slug: config.compare_plan_slug.trim(),
        deadline: config.deadline || null,
      },
    });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    recordAudit(supabase, "admin.billing.campaign_offer.updated", {
      entityType: "platform_setting",
      metadata: {
        enabled: config.enabled,
        plan_slug: config.plan_slug.trim(),
        annual_plan_slug: config.annual_plan_slug.trim(),
        compare_plan_slug: config.compare_plan_slug.trim(),
        deadline: config.deadline || null,
      },
    });
    setSaved(true);
    refresh();
  };

  if (loading) return null;

  const state = resolveCampaignOffer({
    enabled: config.enabled,
    plan_slug: config.plan_slug,
    annual_plan_slug: config.annual_plan_slug,
    compare_plan_slug: config.compare_plan_slug,
    deadline: config.deadline || null,
  });

  return (
    <Box className="flex flex-col gap-4">
      <RowLine>
        <RowText
          primary={state.closed ? "/assinar mostra o estado fechado" : "/assinar está vendendo"}
          secondary={
            state.reason === "not_configured"
              ? "Informe o plano que a campanha vende e marque Oferta aberta."
              : state.reason === "disabled"
                ? "A oferta existe, mas está desligada."
                : state.reason === "expired"
                  ? "O prazo terminou; o checkout recusa esse plano."
                  : state.deadline
                    ? `Vendendo até ${new Date(state.deadline).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília)`
                    : "Vendendo sem prazo."
          }
        />
        <Chip
          label={state.closed ? state.reason : "aberta"}
          size="small"
          color={state.closed ? "grey" : "success"}
          variant="outlined"
        />
      </RowLine>

      <OfferPreview plans={plans} planSlug={config.plan_slug} compareSlug={config.compare_plan_slug} label="/assinar" />
      {/* Read separately because the annual line is where the audio quota goes
          wrong: the franchise is spent inside ONE billing cycle, so a yearly
          row needs twelve times the monthly figure, and copying the monthly
          number delivers a twelfth of what the page promises. */}
      {config.annual_plan_slug.trim() ? (
        <OfferPreview
          plans={plans}
          planSlug={config.annual_plan_slug}
          compareSlug={config.compare_plan_slug}
          label="/assinar (segundo preço)"
        />
      ) : null}

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={config.enabled}
            onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
          />
        }
        label="Oferta aberta (desmarque para fechar — NÃO desative o plano)"
      />
      <Field
        label="Slug do plano da campanha (o plano que os anúncios vendem)"
        value={config.plan_slug}
        onChange={(value) => setConfig({ ...config, plan_slug: value })}
      />
      <Field
        label="Slug do segundo plano, normalmente o anual (vazio = um preço só)"
        value={config.annual_plan_slug}
        onChange={(value) => setConfig({ ...config, annual_plan_slug: value })}
      />
      <Field
        label="Slug do plano de âncora (preço riscado — vazio para nenhum)"
        value={config.compare_plan_slug}
        onChange={(value) => setConfig({ ...config, compare_plan_slug: value })}
      />
      <Field
        label="Prazo no fuso do SEU navegador (vazio = sem prazo); a página mostra em horário de Brasília"
        type="datetime-local"
        value={toLocalInput(config.deadline)}
        onChange={(value) => setConfig({ ...config, deadline: value ? new Date(value).toISOString() : "" })}
      />

      <Box>
        <Button variant="contained" onClick={save}>
          Salvar oferta de campanha
        </Button>
      </Box>

      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          Salvo. A landing page e a trava do checkout seguem isso na hora.
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
