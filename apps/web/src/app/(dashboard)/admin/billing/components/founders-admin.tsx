"use client";

import { Field, RowLine, RowText } from "./catalog-shared";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Checkbox, Chip, FormControlLabel } from "@mui/material";

import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type OfferConfig = {
  enabled: boolean;
  plan_slug: string;
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

const EMPTY: OfferConfig = { enabled: false, plan_slug: "pro-fundador", seats: 30, deadline: "" };

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
 */
export default function FoundersAdmin() {
  const [config, setConfig] = useState<OfferConfig>(EMPTY);
  const [state, setState] = useState<OfferState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data: setting }, { data: live }] = await Promise.all([
      supabase.from("platform_settings").select("value").eq("key", "founders").maybeSingle(),
      supabase.rpc("founders_offer"),
    ]);
    const value = (setting?.value ?? {}) as Partial<OfferConfig>;
    setConfig({
      enabled: value.enabled === true,
      plan_slug: typeof value.plan_slug === "string" ? value.plan_slug : EMPTY.plan_slug,
      seats: Number.isFinite(Number(value.seats)) ? Number(value.seats) : EMPTY.seats,
      deadline: typeof value.deadline === "string" ? value.deadline : "",
    });
    setState((live as OfferState | null) ?? null);
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
      value: {
        enabled: config.enabled,
        plan_slug: config.plan_slug.trim(),
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
      metadata: { enabled: config.enabled, seats: Number(config.seats) || 0, plan_slug: config.plan_slug.trim() },
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
        label="Seats"
        type="number"
        value={config.seats}
        onChange={(value) => setConfig({ ...config, seats: Number(value) })}
      />
      <Field
        label="Deadline (empty = no deadline)"
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
