"use client";

import { Field, RowLine, RowText } from "./catalog-shared";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Checkbox, Chip, FormControlLabel } from "@mui/material";

import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type OfferConfig = {
  enabled: boolean;
  window_hours: number;
  coupon_code: string;
  first_consultation: boolean;
  usage_80: boolean;
};

const EMPTY: OfferConfig = {
  enabled: false,
  window_hours: 48,
  coupon_code: "",
  first_consultation: true,
  usage_80: true,
};

/**
 * The two trial-moment offers (migration 0088).
 *
 * The operator's job is a campaign decision — run it or not, with what benefit,
 * for how long — plus seeing whether it is actually converting. So the counts
 * sit next to the switch: an offer nobody opens is a copy problem, and an offer
 * that opens but never converts is a price problem. They need different fixes,
 * and the numbers are the only way to tell them apart.
 */
export default function ConversionOffersAdmin() {
  const [config, setConfig] = useState<OfferConfig>(EMPTY);
  const [stats, setStats] = useState<{ trigger: string; opened: number; converted: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data: setting }, { data: rows }] = await Promise.all([
      supabase.from("platform_settings").select("value").eq("key", "conversion_offers").maybeSingle(),
      supabase.from("conversion_offers").select("trigger, converted_at"),
    ]);
    const value = (setting?.value ?? {}) as Partial<OfferConfig>;
    setConfig({
      enabled: value.enabled === true,
      window_hours: Number.isFinite(Number(value.window_hours)) ? Number(value.window_hours) : EMPTY.window_hours,
      coupon_code: typeof value.coupon_code === "string" ? value.coupon_code : "",
      first_consultation: value.first_consultation !== false,
      usage_80: value.usage_80 !== false,
    });

    const grouped = new Map<string, { opened: number; converted: number }>();
    for (const row of (rows ?? []) as { trigger: string; converted_at: string | null }[]) {
      const entry = grouped.get(row.trigger) ?? { opened: 0, converted: 0 };
      entry.opened += 1;
      if (row.converted_at) entry.converted += 1;
      grouped.set(row.trigger, entry);
    }
    setStats([...grouped.entries()].map(([trigger, counts]) => ({ trigger, ...counts })));
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
      key: "conversion_offers",
      value: {
        enabled: config.enabled,
        window_hours: Math.max(Number(config.window_hours) || 48, 1),
        coupon_code: config.coupon_code.trim().toUpperCase(),
        first_consultation: config.first_consultation,
        usage_80: config.usage_80,
      },
    });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    recordAudit(supabase, "admin.billing.conversion_offers.updated", {
      entityType: "platform_setting",
      metadata: { enabled: config.enabled, window_hours: config.window_hours, coupon: config.coupon_code.trim() },
    });
    setSaved(true);
    refresh();
  };

  if (loading) return null;

  return (
    <Box className="flex flex-col gap-4">
      {stats.length === 0 ? (
        <RowLine>
          <RowText primary="No offers opened yet" secondary="Counts appear here once the first trigger fires." />
        </RowLine>
      ) : (
        stats.map((row) => (
          <RowLine key={row.trigger}>
            <RowText
              primary={`${row.trigger} · ${row.opened} opened · ${row.converted} converted`}
              secondary={
                row.opened > 0
                  ? `${Math.round((row.converted / row.opened) * 100)}% conversion — low open counts mean the trigger is not firing; low conversion means the offer itself is not landing.`
                  : undefined
              }
            />
            <Chip label={row.trigger} size="small" variant="outlined" />
          </RowLine>
        ))
      )}

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={config.enabled}
            onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
          />
        }
        label="Campaign running"
      />
      <Box className="flex flex-row flex-wrap gap-4">
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={config.first_consultation}
              onChange={(event) => setConfig({ ...config, first_consultation: event.target.checked })}
            />
          }
          label="Trigger: first finalized consultation"
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={config.usage_80}
              onChange={(event) => setConfig({ ...config, usage_80: event.target.checked })}
            />
          }
          label="Trigger: 80% of trial minutes"
        />
      </Box>
      <Field
        label="Window (hours)"
        type="number"
        value={config.window_hours}
        onChange={(value) => setConfig({ ...config, window_hours: Number(value) })}
      />
      <Field
        label="Coupon code applied by the offer (must exist in the Coupons tab)"
        value={config.coupon_code}
        onChange={(value) => setConfig({ ...config, coupon_code: value })}
      />

      <Box>
        <Button variant="contained" onClick={save}>
          Save campaign
        </Button>
      </Box>

      {/* The trap that costs real money, stated where the decision is made. */}
      <Alert severity="warning" className="neutral bg-background-paper/60!">
        Both providers apply a coupon to EVERY cycle (Stripe `duration: forever`, Asaas a discounted subscription
        value). A 20% code here is 20% off for as long as she stays, not a first-month promotion. Size it accordingly,
        or use a coupon with a `valid_until` in the Coupons tab.
      </Alert>
      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          Saved. Offers already open keep the benefit and deadline they were given — changing the campaign never
          rewrites a promise already made.
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
