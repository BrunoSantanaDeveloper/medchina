"use client";

import { useCallback, useEffect, useState } from "react";

import { LOCAL_STORAGE_KEYS } from "@/constants";
import { FIRST_CONSULTATION_GUIDE_STEP, getOnboardingFlowKey } from "@/lib/onboarding";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { completeStep, getOnboardingState } from "@flyee/onboarding";

/**
 * Should the consultation screen show its first-visit guide?
 *
 * Yes while this practice has never closed a record AND she has not dismissed
 * it. Both are read from the database — the guide follows the account, not the
 * browser — and the answer "no" is then remembered locally, per workspace, so
 * the screen she spends her day on stops asking after the first time. The local
 * note is only ever a shortcut for "no": losing it costs two cheap reads, never
 * a wrong answer.
 *
 * It starts hidden and only appears once the reads say so. A guide that flashes
 * on every load for someone with a thousand records is worse than one that
 * arrives a moment late for someone on her first.
 */
export function useFirstConsultationGuide(orgId: string | null, enabled: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!orgId || !enabled || !isSupabaseConfigured) return;
    const storageKey = `${LOCAL_STORAGE_KEYS.firstConsultationGuide}:${orgId}`;
    if (readFlag(storageKey)) return;

    let active = true;
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !active) return;
      const [finalized, state] = await Promise.all([
        supabase
          .from("consultations")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("status", "finalized"),
        getOnboardingState(supabase, await getOnboardingFlowKey(supabase, user.id)),
      ]);
      if (!active) return;
      // A count that could not be read is not "zero": showing a first-visit
      // guide to someone who may have closed hundreds of records is the one
      // mistake this hook must not make.
      if (finalized.error) return;
      if ((finalized.count ?? 0) > 0 || state.completedSteps.includes(FIRST_CONSULTATION_GUIDE_STEP)) {
        writeFlag(storageKey);
        return;
      }
      setVisible(true);
    };
    void load().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [enabled, orgId]);

  const dismiss = useCallback(async () => {
    setVisible(false);
    if (!orgId || !isSupabaseConfigured) return;
    writeFlag(`${LOCAL_STORAGE_KEYS.firstConsultationGuide}:${orgId}`);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await completeStep(supabase, await getOnboardingFlowKey(supabase, user.id), FIRST_CONSULTATION_GUIDE_STEP);
    } catch {
      // The guide is already gone on this device; on another one it may be
      // offered once more, which is a nuisance and not a fault.
    }
  }, [orgId]);

  return { visible, dismiss };
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "done";
  } catch {
    // Storage refused (private mode): fall back to asking the database.
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, "done");
  } catch {
    // Storage refused (private mode): the database still knows.
  }
}
