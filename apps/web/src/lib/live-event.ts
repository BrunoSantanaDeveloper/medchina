import "server-only";

import { cookies } from "next/headers";

import { COOKIE_KEYS } from "@/constants";
import { hashEventToken, isEventTokenShape, type LiveEventRow } from "@/lib/live-event-shared";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The server side of the live-event page (docs/PAGINA-EVENTO.md).
 *
 * `live_events` is NOT anon-readable (it holds the Community invite and the
 * stream — migration 0112), so everything here goes through the service role and
 * the page decides what its state allows it to render. Nothing in this module is
 * ever sent to the browser as a whole row.
 */

const EVENT_COLUMNS =
  "id, slug, title, starts_at, duration_minutes, state, owner_phone, group_invite_url, stream_url, recording_url, ip_window_limit, updated_at";

/** The service client, or null on a fresh clone without Supabase (the page degrades). */
export function liveEventService(): SupabaseClient | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

export async function getLiveEvent(slug: string): Promise<LiveEventRow | null> {
  const service = liveEventService();
  if (!service) return null;
  const { data, error } = await service.from("live_events").select(EVENT_COLUMNS).eq("slug", slug).maybeSingle();
  if (error || !data) return null;
  return data as LiveEventRow;
}

/**
 * Is this browser registered for this event? Reads the httpOnly cookie, checks
 * its shape before touching the database, and accepts only a token that exists,
 * has not expired and belongs to THIS event.
 *
 * Returns the registration id only — never the lead's name: the cookie may have
 * been minted by someone who typed another person's number (a repeat
 * registration is allowed), and showing the stored name would reveal it.
 */
/**
 * The registration this browser's cookie holds for the event, with the token
 * itself: the page shows it back as her personal link and the QR, so a
 * reload on the computer still offers the way into the group on the phone.
 */
export async function getRegistrationFromCookie(
  eventId: string,
): Promise<{ registrationId: string; token: string } | null> {
  const token = (await cookies()).get(COOKIE_KEYS.liveEvent)?.value;
  if (!isEventTokenShape(token)) return null;
  const found = await getRegistrationFromToken(eventId, token);
  return found ? { registrationId: found.registrationId, token } : null;
}

export async function getRegistrationFromToken(
  eventId: string | null,
  token: string,
): Promise<{ registrationId: string; eventId: string } | null> {
  if (!isEventTokenShape(token)) return null;
  const service = liveEventService();
  if (!service) return null;
  const { data, error } = await service
    .from("live_event_tokens")
    .select("registration_id, expires_at, live_event_registrations!inner(event_id)")
    .eq("token_hash", hashEventToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  const rel = data.live_event_registrations as { event_id: string } | { event_id: string }[] | null;
  const registrationEvent = (Array.isArray(rel) ? rel[0] : rel)?.event_id;
  if (!registrationEvent || (eventId && registrationEvent !== eventId)) return null;
  return { registrationId: data.registration_id as string, eventId: registrationEvent };
}

export type ViewerPlan = "anonymous" | "free_or_trial" | "paying";

export type LiveEventViewer = {
  plan: ViewerPlan;
  isSuperadmin: boolean;
  /** Prefill only — for the signed-in professional, from her own profile. */
  name: string | null;
  email: string | null;
};

/**
 * Who is looking, for two decisions: whether to show a purchase CTA, and whether
 * a draft event may be previewed.
 *
 * Someone who ALREADY pays must not get a "subscribe" button: /assinar sends a
 * signed-in visitor straight to the checkout, and there a live paid plan is
 * replaced with no credit for the days already paid (assinatura/page.tsx,
 * BILLING-AUDIT A1). Same query as the checkout: the first membership is THE
 * workspace in the MVP; a trialing subscription is not "paying".
 */
export async function getLiveEventViewer(): Promise<LiveEventViewer> {
  const anonymous: LiveEventViewer = { plan: "anonymous", isSuperadmin: false, name: null, email: null };
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return anonymous;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return anonymous;

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("profiles").select("display_name, is_superadmin").eq("id", user.id).maybeSingle(),
    supabase
      .from("memberships")
      .select("org_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  let plan: ViewerPlan = "free_or_trial";
  const orgId = (membership?.org_id as string | undefined) ?? null;
  if (orgId) {
    const { data: rows } = await supabase
      .from("subscriptions")
      .select("status, plans(is_free)")
      .eq("org_id", orgId)
      .in("status", ["trialing", "active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(5);
    const paying = (rows ?? []).some((row) => {
      if (row.status === "trialing") return false;
      const rel = row.plans as { is_free?: boolean } | { is_free?: boolean }[] | null;
      const planRow = Array.isArray(rel) ? rel[0] : rel;
      return planRow ? planRow.is_free === false : false;
    });
    if (paying) plan = "paying";
  }

  return {
    plan,
    isSuperadmin: Boolean(profile?.is_superadmin),
    name: (profile?.display_name as string | null) ?? null,
    email: user.email ?? null,
  };
}

export type EventTerm = { id: string; version: number; title: string; body: string };

/**
 * The active version of each consent term, read on the server: `consent_terms`
 * has no anon policy, and the text the page shows must be the text the
 * registration pins (the RPC resolves the same "latest active" version).
 */
export async function getEventTerms(): Promise<{ contact: EventTerm | null; marketing: EventTerm | null }> {
  const service = liveEventService();
  if (!service) return { contact: null, marketing: null };
  const { data } = await service
    .from("consent_terms")
    .select("id, slug, version, title, body")
    .in("slug", ["evento-contato", "medchina-novidades"])
    .eq("is_active", true)
    .order("version", { ascending: false });
  const rows = (data ?? []) as (EventTerm & { slug: string })[];
  const pick = (slug: string) => {
    const row = rows.find((item) => item.slug === slug);
    return row ? { id: row.id, version: row.version, title: row.title, body: row.body } : null;
  };
  return { contact: pick("evento-contato"), marketing: pick("medchina-novidades") };
}

/**
 * The YouTube video id from whatever the operator pasted in the console — a
 * watch URL, a youtu.be link, a /live/ or /embed/ URL, or the bare id. Null when
 * nothing usable is there, so the page shows its fallback instead of a broken
 * player.
 */
export function youtubeIdFrom(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return url.pathname.slice(1, 12) || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const fromQuery = url.searchParams.get("v");
      if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery;
      const match = url.pathname.match(/^\/(?:live|embed|shorts)\/([A-Za-z0-9_-]{11})/);
      if (match) return match[1];
    }
  } catch {
    return null;
  }
  return null;
}
