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

const TRIAL_FALLBACK: TrialParams = { days: 14, minutes: 300 };

export function useAudioAllowance(orgId: string | null) {
  const [allowance, setAllowance] = useState<AudioAllowance | null>(null);
  const [trialParams, setTrialParams] = useState<TrialParams>(TRIAL_FALLBACK);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId || !isSupabaseConfigured) {
      setAllowance(null);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const [{ data }, { data: settings }] = await Promise.all([
      supabase.rpc("org_audio_allowance", { target_org: orgId }),
      // The offer the professional is about to accept must be the configured
      // one, not a number frozen into the copy.
      supabase.from("platform_settings").select("value").eq("key", "trial").maybeSingle(),
    ]);
    setAllowance(data ? toAllowance(data as AllowanceRow) : null);
    const value = settings?.value as Partial<TrialParams> | undefined;
    setTrialParams({
      days: Number(value?.days) > 0 ? Number(value?.days) : TRIAL_FALLBACK.days,
      minutes: Number(value?.minutes) > 0 ? Number(value?.minutes) : TRIAL_FALLBACK.minutes,
    });
    setLoading(false);
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

  return { allowance, trialParams, loading, reload: load, startTrial };
}
