import "server-only";

import { BRAND } from "@/brand";
import { liveEventService } from "@/lib/live-event";
import { aboutEvent } from "@/lib/live-event-common";
import { formatEventStart, generateEventToken, personalEventLink } from "@/lib/live-event-shared";
import { isEmailConfigured, type LiveEventEmailItem, sendLiveEventEmailBatch } from "@flyee/email";

/**
 * E-mails of the live event (docs/PAGINA-EVENTO.md §8). The contract is shared
 * by the page (confirmation after sign-up) and the console (reminder buttons,
 * via the Inngest job or inline).
 *
 * Idempotent by construction: each kind has its `email_<kind>_sent_at` column on
 * `live_event_registrations`, set only for the items the provider accepted; a
 * registration that already has it set, or whose lead opted out
 * (`opted_out_at` / `email_opt_out_at`) or has no e-mail, is skipped. Never
 * throws: a failed e-mail must not fail a sign-up or a console click.
 */
export type LiveEventEmailKind = "confirmation" | "day_before" | "hour_before" | "live" | "recording";

export type LiveEventEmailResult = { sent: number; skipped: number; failed: number };

const SENT_COLUMN: Record<LiveEventEmailKind, string> = {
  confirmation: "email_confirmation_sent_at",
  day_before: "email_day_before_sent_at",
  hour_before: "email_hour_before_sent_at",
  live: "email_live_sent_at",
  recording: "email_recording_sent_at",
};

/** How long a link minted for an e-mail keeps working: the retention window. */
const TOKEN_DAYS = 180;

type LeadRel = {
  email: string | null;
  email_unsubscribe_token: string;
  opted_out_at: string | null;
  email_opt_out_at: string | null;
};

export async function sendLiveEventEmails(input: {
  eventId: string;
  kind: LiveEventEmailKind;
  /** Restrict to these registrations (the confirmation passes exactly one). */
  registrationIds?: string[];
}): Promise<LiveEventEmailResult> {
  const none: LiveEventEmailResult = { sent: 0, skipped: 0, failed: 0 };
  // The confirmation belongs to ONE sign-up; never broadcast it.
  if (input.kind === "confirmation" && !input.registrationIds?.length) return none;

  try {
    const service = liveEventService();
    if (!service) return none;

    const { data: event } = await service
      .from("live_events")
      .select("id, title, topic, starts_at, group_invite_url")
      .eq("id", input.eventId)
      .maybeSingle();
    if (!event) return none;

    const column = SENT_COLUMN[input.kind];
    let query = service
      .from("live_event_registrations")
      .select("id, leads!inner(email, email_unsubscribe_token, opted_out_at, email_opt_out_at)")
      .eq("event_id", input.eventId)
      .is(column, null)
      .limit(5000);
    if (input.registrationIds?.length) query = query.in("id", input.registrationIds);
    const { data: rows, error } = await query;
    if (error || !rows) return none;

    const eligible = rows
      .map((row) => {
        const rel = row.leads as LeadRel | LeadRel[] | null;
        return { id: row.id as string, lead: Array.isArray(rel) ? rel[0] : rel };
      })
      .filter(
        (row): row is { id: string; lead: LeadRel } =>
          Boolean(row.lead?.email) && !row.lead?.opted_out_at && !row.lead?.email_opt_out_at,
      );
    const skipped = rows.length - eligible.length;
    // Without the provider nothing is sent and nothing is marked, so the same
    // button works once RESEND_API_KEY exists.
    if (!isEmailConfigured || eligible.length === 0) return { sent: 0, skipped: rows.length, failed: 0 };

    const starts = event.starts_at ? formatEventStart(event.starts_at as string) : null;
    const expiresAt = new Date(
      (event.starts_at ? new Date(event.starts_at as string).getTime() : Date.now()) + TOKEN_DAYS * 86_400_000,
    ).toISOString();

    // One fresh personal link per message: only hashes are stored, so a link
    // sent earlier cannot be re-read — a new token is minted for this e-mail.
    const minted = eligible.map((row) => ({ row, ...generateEventToken() }));
    const { error: tokenError } = await service
      .from("live_event_tokens")
      .insert(minted.map(({ row, hash }) => ({ token_hash: hash, registration_id: row.id, expires_at: expiresAt })));
    if (tokenError) return { sent: 0, skipped, failed: eligible.length };

    const items: LiveEventEmailItem[] = minted.map(({ row, token }) => ({
      to: row.lead.email as string,
      props: {
        kind: input.kind,
        eventTitle: event.title as string,
        about: aboutEvent({ title: event.title as string, topic: (event.topic as string | null) ?? null }),
        startsLabel: starts?.label ?? null,
        timeLabel: starts?.time ?? null,
        personalLink: personalEventLink(token),
        groupUrl: event.group_invite_url
          ? `${BRAND.siteUrl}/api/public/evento/grupo?i=${encodeURIComponent(token)}`
          : null,
        unsubscribeUrl: `${BRAND.siteUrl}/api/public/evento/descadastrar?t=${row.lead.email_unsubscribe_token}`,
      },
    }));

    const result = await sendLiveEventEmailBatch(items);
    const sentIds = minted.filter((_, index) => result.sent[index]).map(({ row }) => row.id);
    for (let start = 0; start < sentIds.length; start += 200) {
      await service
        .from("live_event_registrations")
        .update({ [column]: new Date().toISOString() })
        .in("id", sentIds.slice(start, start + 200));
    }
    return { sent: sentIds.length, skipped, failed: eligible.length - sentIds.length };
  } catch {
    return none;
  }
}
