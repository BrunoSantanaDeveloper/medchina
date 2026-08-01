"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Button, Typography } from "@mui/material";

import NiEyeOpen from "@/icons/nexture/ni-eye-open";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient, isImpersonating } from "@flyee/auth/client";

type ActiveSession = { reason: string; expiresAt: string; targetName: string | null };

/** mm:ss left in the visit. */
function formatRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Persistent marker that this browser is inside a support impersonation.
 *
 * Fixed rather than inline for the same reason the capture bar is: the
 * operator scrolls, and forgetting whose account you are typing in is the
 * failure mode worth designing against. It states WHOSE account, WHY the
 * access was opened and HOW LONG is left, and it is the way out.
 *
 * The details come from the database under the impersonated user's own RLS
 * (she may read impersonation rows that target her), so a stale or forged
 * cookie renders nothing instead of a fake banner. Not red: this is a state,
 * not a failure — red stays reserved for clinical risk.
 */
export default function ImpersonationBanner() {
  const t = useTranslations("dashboard");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    if (!isSupabaseConfigured || !isImpersonating()) return;
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("impersonation_sessions")
        .select("reason, expires_at")
        .eq("target_user_id", user.id)
        .is("ended_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return;

      const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();

      setSession({
        reason: data.reason,
        expiresAt: data.expires_at,
        targetName: profile?.display_name ?? user.email ?? null,
      });
    };
    load();
  }, []);

  // Wall clock, never accumulated ticks — a throttled background tab would
  // otherwise report a visit as shorter than it is.
  useEffect(() => {
    if (!session) return;
    const deadline = new Date(session.expiresAt).getTime();
    const tick = () => setRemaining(formatRemaining(deadline - Date.now()));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [session]);

  if (!session) return null;

  return (
    <Box
      role="status"
      className="bg-secondary text-secondary-contrast fixed inset-x-3 bottom-3 z-50 flex flex-row flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-2.5 shadow-lg sm:inset-x-auto sm:bottom-5 sm:left-5 sm:max-w-xl"
    >
      <NiEyeOpen size="small" />
      <Box className="flex min-w-0 flex-col">
        <Typography variant="body2" className="font-medium">
          {t("impersonation-active", { name: session.targetName ?? "" })}
        </Typography>
        <Typography variant="caption" className="opacity-80">
          {t("impersonation-scope")} · {t("impersonation-reason", { reason: session.reason })} ·{" "}
          {t("impersonation-remaining", { time: remaining })}
        </Typography>
      </Box>
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        className="ml-auto shrink-0"
        href="/api/impersonation/exit"
      >
        {t("impersonation-exit")}
      </Button>
    </Box>
  );
}
