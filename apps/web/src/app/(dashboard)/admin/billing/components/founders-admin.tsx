"use client";

import { Field, RowLine, RowText } from "./catalog-shared";
import OfferPreview, { type OfferPlanRow } from "./offer-preview";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Checkbox, Chip, FormControlLabel } from "@mui/material";

import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type OfferConfig = {
  enabled: boolean;
  plan_slug: string;
  /** Plan whose price the landing page strikes through. Empty = no anchor. */
  compare_plan_slug: string;
  seats: number;
  /** ISO string, or "" for no deadline. */
  deadline: string;
};

type OfferState = {
  seats_total: number;
  seats_taken: number;
  seats_left: number;
  closed: boolean;
  reason: string;
  plan_slug: string | null;
};

const EMPTY: OfferConfig = {
  enabled: false,
  plan_slug: "pro-fundador",
  compare_plan_slug: "",
  seats: 30,
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
 * The founders offer switch (migration 0087).
 *
 * The operator's job here is a campaign decision, not data entry: open or close
 * the offer, and see how many seats are REALLY taken. So the live count sits
 * next to the switch — the whole point of the mechanism is that the number on
 * the landing page is this number, and a console that only wrote settings would
 * leave the operator guessing whether the page agrees.
 *
 * Closing the offer means unchecking "Oferta aberta" — never deactivating the
 * plan, which would also make it unbuyable for the founders who already hold it
 * and for anyone finishing a checkout.
 *
 * Two things this console got wrong, both fixed here because both were silent:
 *
 *  - It wrote the whole `founders` JSON from four fields, so every Save DELETED
 *    `compare_plan_slug` — the anchor the landing page strikes through — and
 *    offered no field to put it back. It now edits that key and merges over
 *    whatever else the row holds, so an unknown key can never be dropped again.
 *  - It reported seats but never whether the page will actually RENDER what was
 *    configured. The readout below resolves both plans and says what the
 *    visitor will see, including the audio quota, which on a yearly line is a
 *    quota for the whole year (`org_audio_allowance`, migration 0024) and is
 *    the easiest thing in this offer to get wrong by a factor of twelve.
 */
export default function FoundersAdmin() {
  const [config, setConfig] = useState<OfferConfig>(EMPTY);
  // Everything the row holds, so Save can merge instead of replace.
  const [rawValue, setRawValue] = useState<Record<string, unknown>>({});
  const [state, setState] = useState<OfferState | null>(null);
  const [plans, setPlans] = useState<OfferPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data: setting }, { data: live }, { data: planRows }] = await Promise.all([
      supabase.from("platform_settings").select("value").eq("key", "founders").maybeSingle(),
      supabase.rpc("founders_offer"),
      supabase.from("plans").select("slug, name, period, price_cents, is_active, limits"),
    ]);
    const value = (setting?.value ?? {}) as Partial<OfferConfig>;
    setRawValue((setting?.value ?? {}) as Record<string, unknown>);
    setConfig({
      enabled: value.enabled === true,
      plan_slug: typeof value.plan_slug === "string" ? value.plan_slug : EMPTY.plan_slug,
      compare_plan_slug: typeof value.compare_plan_slug === "string" ? value.compare_plan_slug : "",
      seats: Number.isFinite(Number(value.seats)) ? Number(value.seats) : EMPTY.seats,
      deadline: typeof value.deadline === "string" ? value.deadline : "",
    });
    setState((live as OfferState | null) ?? null);
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
      key: "founders",
      // Merge, never replace: this form does not own every key of the row.
      value: {
        ...rawValue,
        enabled: config.enabled,
        plan_slug: config.plan_slug.trim(),
        compare_plan_slug: config.compare_plan_slug.trim(),
        seats: Number(config.seats) || 0,
        deadline: config.deadline || null,
      },
    });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    recordAudit(supabase, "admin.billing.founders_offer.updated", {
      entityType: "platform_setting",
      metadata: {
        enabled: config.enabled,
        seats: Number(config.seats) || 0,
        plan_slug: config.plan_slug.trim(),
        compare_plan_slug: config.compare_plan_slug.trim(),
      },
    });
    setSaved(true);
    refresh();
  };

  if (loading) return null;

  return (
    <Box className="flex flex-col gap-4">
      {/* What the public counter says right now, and what the checkout will do
          — read from the same function both of them use. */}
      <RowLine>
        <RowText
          primary={
            state
              ? `${state.seats_taken} de ${state.seats_total} vagas ocupadas · restam ${state.seats_left}`
              : "Situação da oferta indisponível"
          }
          secondary={
            state?.plan_slug
              ? `Plano ${state.plan_slug} · o checkout ${state.closed ? "RECUSA" : "aceita"} novos fundadores (${state.reason})`
              : "Nenhum plano configurado — defina o slug abaixo e crie o plano na aba Planos."
          }
        />
        {state && (
          <Chip
            label={state.closed ? state.reason : "aberta"}
            size="small"
            color={state.closed ? "grey" : "success"}
            variant="outlined"
          />
        )}
      </RowLine>

      {/* What the visitor will actually see, resolved by the same component
          the campaign console uses. */}
      <OfferPreview
        plans={plans}
        planSlug={config.plan_slug}
        compareSlug={config.compare_plan_slug}
        label="/fundadores"
      />

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
        label="Slug do plano da oferta"
        value={config.plan_slug}
        onChange={(value) => setConfig({ ...config, plan_slug: value })}
      />
      <Field
        label="Slug do plano de âncora (preço riscado — vazio para nenhum)"
        value={config.compare_plan_slug}
        onChange={(value) => setConfig({ ...config, compare_plan_slug: value })}
      />
      <Field
        label="Vagas"
        type="number"
        value={config.seats}
        onChange={(value) => setConfig({ ...config, seats: Number(value) })}
      />
      <Field
        label="Prazo no fuso do SEU navegador (vazio = sem prazo); a página mostra em horário de Brasília"
        type="datetime-local"
        value={toLocalInput(config.deadline)}
        onChange={(value) => setConfig({ ...config, deadline: value ? new Date(value).toISOString() : "" })}
      />

      <Box>
        <Button variant="contained" onClick={save}>
          Salvar oferta
        </Button>
      </Box>

      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          Salvo. O contador público e a trava do checkout seguem isso na hora.
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
