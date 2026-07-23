"use client";

import { useCallback, useEffect, useState } from "react";

import { type AllowanceRow, type AudioAllowance, toAllowance } from "@/lib/audio-allowance";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * Reads the workspace's audio allowance (minutes left, trial state) for the
 * screens that must reflect it. Read-only by nature: `start_pro_trial` is the
 * only thing here that changes anything, and it is a deliberate call the
 * professional makes (PRD §5.7) — never a side effect of rendering.
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
    const supabase = createClient();
    const { data, error } = await supabase.rpc("start_pro_trial", { target_org: orgId });
    if (error) return "allowance_unavailable";
    if (data) setAllowance(toAllowance(data as AllowanceRow));
    return null;
  }, [orgId]);

  return { allowance, trialParams, loading, error, reload: load, startTrial };
}
