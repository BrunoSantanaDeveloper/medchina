import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { BRAND } from "@/brand";

/**
 * What the live-event page, its API routes, the console and the e-mail job all
 * need to agree on (docs/PAGINA-EVENTO.md). Kept apart from `live-event.ts` so
 * the e-mail job can mint a personal link without importing the page's reader.
 */

export type LiveEventState = "rascunho" | "inscricoes" | "ao_vivo" | "encerrado";

export type LiveEventRow = {
  id: string;
  slug: string;
  title: string;
  starts_at: string | null;
  duration_minutes: number | null;
  state: LiveEventState;
  owner_phone: string | null;
  group_invite_url: string | null;
  stream_url: string | null;
  recording_url: string | null;
  ip_window_limit: number;
  updated_at: string;
  // Page content (migration 0113) — rendered by the one event template.
  topic: string | null;
  headline: string | null;
  byline: string;
  lead: string | null;
  lead_after: string | null;
  topics: unknown;
  audience_heading: string | null;
  audience: string | null;
  description: string | null;
  ended_behavior: "recording" | "redirect";
  ended_redirect_path: string | null;
  archived_at: string | null;
  page_title: string | null;
  offer_angle: string | null;
  published_at: string | null;
};

// ---------- Tokens (cookie + personal link) ----------

/** 32 random bytes, base64url: 43 characters, no padding. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** A fresh token and the only form of it the database ever sees. */
export function generateEventToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashEventToken(token) };
}

export function hashEventToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check before any database lookup: a cookie or query param is attacker-controlled. */
export function isEventTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

/**
 * The cookie is a pointer, not the gate: `live_event_tokens.expires_at` decides
 * validity. It holds the tokens of every event this browser registered for
 * (`addEventToken`, lib/live-event-common.ts). 90 days like the attribution
 * cookie, whose flags it copies — httpOnly, never the coupon's client-readable
 * ones.
 */
export const EVENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

export const eventCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: EVENT_COOKIE_MAX_AGE,
};

/**
 * The personal link: recreates the cookie on any browser or device. Needed
 * because Instagram's in-app browser and the iPhone's WhatsApp link view do not
 * share cookies with Chrome/Safari — without it, a registered person would land
 * on the form again on the day.
 */
export function personalEventLink(token: string): string {
  return `${BRAND.siteUrl}/api/public/evento/entrar?i=${encodeURIComponent(token)}`;
}

// ---------- Untrusted text ----------

/**
 * Trim, drop control characters and cut to `max`: every string that arrives
 * from a form field or a query parameter goes through this before it reaches
 * the RPC (the database CHECKs are the second fence).
 */
export function cleanText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : "";
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += char;
  }
  return out.trim().slice(0, max);
}

// ---------- Per-network window ----------

/**
 * sha256(salt + IP), for the per-network registration window. Never the raw IP.
 * The salt is `LEAD_HASH_SALT`, falling back to the service key (server-only,
 * already secret); with neither, there is no hash and the window is off — the
 * unique phone and the honeypot still stand.
 */
export function hashClientIp(ip: string | null | undefined): string | null {
  const address = ip?.split(",")[0]?.trim();
  if (!address) return null;
  const salt = process.env.LEAD_HASH_SALT?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!salt) return null;
  return createHash("sha256").update(`${salt}:${address}`).digest("hex");
}

// ---------- Dates, always in Brasília time ----------

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
const TIME_PARTS = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Sao_Paulo",
});

export type EventStartLabel = {
  /** "3 de outubro" */
  date: string;
  /** "sexta-feira" */
  weekday: string;
  /** "20h" or "20h30" */
  time: string;
  /** "3 de outubro, às 20h (horário de Brasília)" */
  label: string;
};

/**
 * The server runs in UTC; the audience is in Brazil. Every date shown for the
 * event goes through here, with the time zone written out (FUNIL Riscos 5).
 */
export function formatEventStart(iso: string): EventStartLabel {
  const when = new Date(iso);
  const parts = Object.fromEntries(TIME_PARTS.formatToParts(when).map((part) => [part.type, part.value]));
  const time = parts.minute === "00" ? `${Number(parts.hour)}h` : `${Number(parts.hour)}h${parts.minute}`;
  const date = DATE_FORMAT.format(when);
  return {
    date,
    weekday: WEEKDAY_FORMAT.format(when),
    time,
    label: `${date}, às ${time} (horário de Brasília)`,
  };
}
