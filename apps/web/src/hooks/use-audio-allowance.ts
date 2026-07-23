"use client";

import { useCallback, useEffect, useState } from "react";

import { type AllowanceRow, type AudioAllowance, toAllowance } from "@/lib/audio-allowance";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * Reads the workspace's audio allowance (minutes left, trial state) for the
 * screens that must reflect it. Read-only by nature: starting the Pro trial is
 * the only thing here that changes anything, and it is a deliberate call the
 * professional makes (PRD §5.7) — never a side effect of rendering. That start
 * now goes through POST /api/billing/start-trial (server-side) so the Meta CAPI
 * StartTrial conversion fires on real success; the reads stay client-side.
 */
/** What the trial is worth, as configured by the superadmin (never hardcoded). */
export type TrialParams = { days: number; minutes: number };

export function useAudioAllowance(orgId: string | null) {
  const [allowance, setAllowance] = useState<AudioAllowance | null>(null);
  const [trialParams, setTrialParams] = useState<TrialParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    if (!orgId || !isSupabaseConfigured) {
      setAllowance(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const [allowanceResult, settingsResult] = await Promise.all([
        supabase.rpc("org_audio_allowance", { target_org: orgId }),
        // The offer the professional is about to accept must be the configured
        // one, not a number frozen into the copy.
        supabase.from("platform_settings").select("value").eq("key", "trial").maybeSingle(),
      ]);
      if (allowanceResult.error) {
        setAllowance(null);
        setError(true);
      } else {
        setAllowance(allowanceResult.data ? toAllowance(allowanceResult.data as AllowanceRow) : null);
      }
      const value = settingsResult.data?.value as Partial<TrialParams> | undefined;
      const days = Number(value?.days);
      const minutes = Number(value?.minutes);
      setTrialParams(days > 0 && minutes > 0 ? { days, minutes } : null);
    } catch {
      setAllowance(null);
      setTrialParams(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const startTrial = useCallback(async (): Promise<string | null> => {
    if (!orgId) return "not_authorized";
    // Started server-side (POST /api/billing/start-trial) so the Meta CAPI
    // StartTrial conversion fires on real success and cannot be spoofed.
    // Same RLS authorization, same allowance row back — the return contract
    // (null on success, an error string otherwise) is unchanged for callers.
    try {
      const response = await fetch("/api/billing/start-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const json = (await response.json().catch(() => null)) as { allowance?: AllowanceRow; error?: string } | null;
      if (!response.ok) return json?.error ?? "allowance_unavailable";
      if (json?.allowance) setAllowance(toAllowance(json.allowance));
      return null;
    } catch {
      return "allowance_unavailable";
    }
  }, [orgId]);

  return { allowance, trialParams, loading, error, reload: load, startTrial };
}
