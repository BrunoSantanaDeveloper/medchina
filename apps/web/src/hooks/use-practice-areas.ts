"use client";

import { useEffect, useState } from "react";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * Whether the signed-in professional declares the cycle/fertility area
 * (`profiles.practice_areas`, migration 0103). It decides where the patient's
 * "acompanhamento de ciclo e fertilidade" mark is OFFERED: the block it opens
 * only exists for a practice that follows fertility.
 *
 * A pending or failed read answers `false` — the mark is then simply not
 * offered, which loses nothing (a patient already marked still shows it).
 */
export function usePracticeAreas(): { fertilityCare: boolean; loading: boolean } {
  const [state, setState] = useState({ fertilityCare: false, loading: true });

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!isSupabaseConfigured) {
        if (active) setState({ fertilityCare: false, loading: false });
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) setState({ fertilityCare: false, loading: false });
        return;
      }
      const { data } = await supabase.from("profiles").select("practice_areas").eq("id", user.id).maybeSingle();
      if (active) {
        setState({
          fertilityCare: ((data?.practice_areas as string[] | null) ?? []).includes("fertility"),
          loading: false,
        });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
