"use client";

import { Field, RowLine, RowText } from "./catalog-shared";
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

type PlanRow = {
  slug: string;
  name: string;
  period: string | null;
  price_cents: number;
  is_active: boolean;
  limits: Record<string, number> | null;
};

const EMPTY: OfferConfig = {
  enabled: false,
  plan_slug: "pro-fundador",
  compare_plan_slug: "",
  seats: 30,
  deadline: "",
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

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
 * Closing the offer means unchecking "Offer open" — never deactivating the
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
  const [plans, setPlans] = useState<PlanRow[]>([]);
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
    setPlans((planRows as PlanRow[] | null) ?? []);
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

  const offerPlan = plans.find((row) => row.slug === config.plan_slug.trim()) ?? null;
  const comparePlan = config.compare_plan_slug.trim()
    ? (plans.find((row) => row.slug === config.compare_plan_slug.trim()) ?? null)
    : null;

  // Mirrors the landing page exactly: a monthly anchor is annualized, a period
  // mismatch yields no anchor, and an anchor cheaper than the offer is dropped.
  const anchorCents =
    comparePlan && offerPlan
      ? comparePlan.period === "monthly" && offerPlan.period === "yearly"
        ? comparePlan.price_cents * 12
        : comparePlan.period === offerPlan.period
          ? comparePlan.price_cents
          : 0
      : 0;
  const anchorRenders = Boolean(offerPlan && comparePlan?.is_active && anchorCents > offerPlan.price_cents);

  const offerMinutes = Number(offerPlan?.limits?.audio_minutes ?? 0);
  // What the same limit buys on the monthly reference plan, over a year. A
  // yearly offer copied from a monthly plan's limits delivers one twelfth.
  const proMinutes = Number(plans.find((row) => row.slug === "pro")?.limits?.audio_minutes ?? 0);
  const minutesLookShort =
    offerPlan?.period === "yearly" && proMinutes > 0 && offerMinutes > 0 && offerMinutes < proMinutes * 12;

  return (
    <Box className="flex flex-col gap-4">
      {/* What the public counter says right now, and what the checkout will do
          — read from the same function both of them use. */}
      <RowLine>
        <RowText
          primary={
            state
              ? `${state.seats_taken} of ${state.seats_total} seats taken · ${state.seats_left} left`
              : "Offer state unavailable"
          }
          secondary={
            state?.plan_slug
              ? `Plan ${state.plan_slug} · checkout ${state.closed ? "REFUSES" : "accepts"} new founders (${state.reason})`
              : "No plan configured — set the slug below and create the plan in the Plans tab."
          }
        />
        {state && (
          <Chip
            label={state.closed ? state.reason : "open"}
            size="small"
            color={state.closed ? "grey" : "success"}
            variant="outlined"
          />
        )}
      </RowLine>

      {/* What the visitor will actually SEE, resolved from the same rows the
          page reads. A console that only writes settings hides its own typos. */}
      <RowLine>
        <RowText
          primary={
            offerPlan
              ? `Landing shows ${BRL.format(offerPlan.price_cents / 100)} ${offerPlan.period === "yearly" ? "per year" : `per ${offerPlan.period ?? "cycle"}`}${
                  anchorRenders ? ` · struck ${BRL.format(anchorCents / 100)}/year` : " · NO struck price"
                }`
              : "Offer plan not found in the catalog"
          }
          secondary={
            offerPlan
              ? `Audio quota ${offerMinutes} min per ${offerPlan.period === "yearly" ? "year" : (offerPlan.period ?? "cycle")}${
                  anchorRenders
                    ? ""
                    : comparePlan
                      ? ` · anchor "${comparePlan.slug}" does not render (inactive, cheaper than the offer, or an incomparable period)`
                      : " · no anchor plan set"
                }`
              : "Create it in the Plans tab: Active, not Listed."
          }
        />
      </RowLine>

      {minutesLookShort && (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          The audio quota is spent over ONE BILLING CYCLE, and this plan bills yearly — so {offerMinutes} min is the
          whole year, while the monthly Pro gives {proMinutes} min every month ({proMinutes * 12} per year). If this
          offer is sold as the complete Pro, set audio_minutes to {proMinutes * 12} in the Plans tab.
        </Alert>
      )}

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={config.enabled}
            onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
          />
        }
        label="Offer open (uncheck to close it — do NOT deactivate the plan)"
      />
      <Field
        label="Offer plan slug"
        value={config.plan_slug}
        onChange={(value) => setConfig({ ...config, plan_slug: value })}
      />
      <Field
        label="Anchor plan slug (struck-through price — empty for none)"
        value={config.compare_plan_slug}
        onChange={(value) => setConfig({ ...config, compare_plan_slug: value })}
      />
      <Field
        label="Seats"
        type="number"
        value={config.seats}
        onChange={(value) => setConfig({ ...config, seats: Number(value) })}
      />
      <Field
        label="Deadline in YOUR browser's timezone (empty = no deadline); the page prints it in Brasília time"
        type="datetime-local"
        value={toLocalInput(config.deadline)}
        onChange={(value) => setConfig({ ...config, deadline: value ? new Date(value).toISOString() : "" })}
      />

      <Box>
        <Button variant="contained" onClick={save}>
          Save offer
        </Button>
      </Box>

      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          Saved. The public counter and the checkout guard both follow this immediately.
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
