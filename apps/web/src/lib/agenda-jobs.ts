import "server-only";

import { calendarDayRange } from "@/lib/agenda";
import { notifyUsers } from "@/lib/notifications";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The morning briefing (PRD §7.4 asks for controlled frequency): one bell
 * notification on days that ACTUALLY have appointments, never on empty days —
 * relevance is what keeps a nudge from becoming a nag.
 *
 * Deliberately server-side and idempotent: a re-run on the same day notifies
 * nobody twice.
 */

/** Launch market is Brazil; 07:00 America/Sao_Paulo = 10:00 UTC (no DST since 2019). */
const CRON = "0 10 * * *";
const TIMEZONE = "America/Sao_Paulo";

export type MorningBriefingResult = { orgs: number; notified: number; skipped: number };

/** Formats the local time of an appointment for the notification body. */
function localTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

/**
 * Sends today's agenda to every workspace that has appointments today.
 * Exported for verification: the job body is this function, nothing else.
 */
export async function sendMorningBriefings(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<MorningBriefingResult> {
  // Same day boundaries the agenda screens use, so "today" means one thing.
  const { start, end } = calendarDayRange(now, TIMEZONE);

  const { data: appointments } = await supabase
    .from("consultations")
    .select("org_id, scheduled_for")
    .eq("status", "scheduled")
    .gte("scheduled_for", start.toISOString())
    .lt("scheduled_for", end.toISOString())
    .order("scheduled_for", { ascending: true });

  const byOrg = new Map<string, string[]>();
  for (const row of appointments ?? []) {
    const orgId = row.org_id as string;
    const times = byOrg.get(orgId) ?? [];
    times.push(row.scheduled_for as string);
    byOrg.set(orgId, times);
  }

  let notified = 0;
  let skipped = 0;

  for (const [orgId, times] of byOrg) {
    const { data: members } = await supabase.from("memberships").select("user_id").eq("org_id", orgId);
    const userIds = (members ?? []).map((row) => row.user_id as string);
    if (userIds.length === 0) continue;

    // Idempotent by construction: one briefing per workspace per local day,
    // however many times the cron (or a retry) runs.
    const { count: alreadySent } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("type", "agenda")
      .gte("created_at", start.toISOString())
      .in("user_id", userIds);
    if ((alreadySent ?? 0) > 0) {
      skipped += 1;
      continue;
    }

    // Stored text, written in the default locale (pt-BR) at creation.
    const preview = times.slice(0, 3).map(localTime).join(", ");
    const suffix = times.length > 3 ? `, +${times.length - 3}` : "";
    await notifyUsers(userIds, {
      type: "agenda",
      title: times.length === 1 ? "Você tem 1 consulta hoje" : `Você tem ${times.length} consultas hoje`,
      body: `Horários: ${preview}${suffix}. Prepare-se em um toque na agenda.`,
      href: "/agenda",
    });
    notified += 1;
  }

  return { orgs: byOrg.size, notified, skipped };
}

export const morningBriefingFunction = inngest.createFunction(
  { id: "agenda-morning-briefing", retries: 1, concurrency: { limit: 1 } },
  { cron: CRON },
  async ({ step }) =>
    step.run("send-morning-briefings", async () => {
      // The service role reads across workspaces; membership decides who is
      // notified, so no tenant ever learns about another's agenda.
      return sendMorningBriefings(createServiceClient());
    }),
);

export const agendaFunctions = [morningBriefingFunction];
