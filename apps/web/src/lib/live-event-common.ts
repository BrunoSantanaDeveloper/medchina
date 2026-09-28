/**
 * What the live-event pages, their public routes and the console must agree on
 * — pure, dependency-free, safe on the client (docs/PAGINA-EVENTO.md; migration
 * 0113). The server-only half (tokens, hashing, the service client) lives in
 * `live-event-shared.ts` / `live-event.ts`.
 */

/** The slug shape the database CHECK enforces (`live_events.slug`). */
export const EVENT_SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{2,59}$/;

export function isEventSlug(value: unknown): value is string {
  return typeof value === "string" && EVENT_SLUG_SHAPE.test(value);
}

/**
 * Events published before the generic route existed keep their own address:
 * `/lei-15345` is printed in e-mails, ads and QR codes already. Every other
 * event lives under `/ao-vivo/<slug>`.
 */
export const LEGACY_EVENT_PATHS: Readonly<Record<string, string>> = { "lei-15345": "/lei-15345" };

export function eventPath(slug: string): string {
  return LEGACY_EVENT_PATHS[slug] ?? `/ao-vivo/${slug}`;
}

/** A suggested slug for a title: lower case, no accents, words joined by "-". */
export function slugFromTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

// ---------- How the event is named in a sentence ----------

export type EventNaming = { title: string; topic: string | null };

/**
 * "no ao vivo sobre a Lei 15.345" with a topic, "no ao vivo “Título”" without
 * one — the phrase every message about the event builds on (e-mail subjects,
 * the WhatsApp messages, the console's 1:1).
 */
export function aboutEvent(event: EventNaming): string {
  const topic = event.topic?.trim();
  return topic ? `sobre ${topic}` : `“${event.title.trim()}”`;
}

// ---------- The registration cookie ----------

/**
 * One cookie holds ONE token per event this browser registered for, newest
 * event first: entries are `<slug>~<token>` joined by "." (neither a slug nor
 * base64url contains "~" or "."). One slot for the whole browser made a second
 * registration erase the first; one slot per TOKEN let a single event's e-mail
 * links (each mints a token) push the other events out. Bounded, so an old
 * event falls off instead of growing the header. A bare token (the first
 * version's format) is read as an entry of an unknown event.
 */
export const EVENT_COOKIE_MAX_EVENTS = 6;

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

type CookieEntry = { slug: string | null; token: string };

function parseEntries(value: string | null | undefined): CookieEntry[] {
  if (!value) return [];
  const entries: CookieEntry[] = [];
  const seenTokens = new Set<string>();
  const seenSlugs = new Set<string>();
  for (const part of value.split(".")) {
    const [first, second] = part.split("~");
    const entry: CookieEntry | null =
      second !== undefined
        ? EVENT_SLUG_SHAPE.test(first) && TOKEN_SHAPE.test(second)
          ? { slug: first, token: second }
          : null
        : TOKEN_SHAPE.test(first)
          ? { slug: null, token: first }
          : null;
    if (!entry || seenTokens.has(entry.token) || (entry.slug && seenSlugs.has(entry.slug))) continue;
    seenTokens.add(entry.token);
    if (entry.slug) seenSlugs.add(entry.slug);
    entries.push(entry);
    if (entries.length === EVENT_COOKIE_MAX_EVENTS) break;
  }
  return entries;
}

/** The tokens in the cookie, newest event first — what the lookups need. */
export function parseEventCookie(value: string | null | undefined): string[] {
  return parseEntries(value).map((entry) => entry.token);
}

/** The cookie with THIS event's token in front, replacing any older token of the same event. */
export function addEventToken(value: string | null | undefined, token: string, slug: string): string {
  const entries = parseEntries(value);
  const serialize = (list: CookieEntry[]) =>
    list
      .slice(0, EVENT_COOKIE_MAX_EVENTS)
      .map((entry) => (entry.slug ? `${entry.slug}~${entry.token}` : entry.token))
      .join(".");
  if (!TOKEN_SHAPE.test(token) || !EVENT_SLUG_SHAPE.test(slug)) return serialize(entries);
  return serialize([{ slug, token }, ...entries.filter((entry) => entry.slug !== slug && entry.token !== token)]);
}

// ---------- Device of the group click ----------

/**
 * Phone or computer, from the user agent — the only thing kept about the
 * device. A tablet counts as a phone: it has the WhatsApp app.
 */
export function deviceFromUserAgent(userAgent: string | null | undefined): "phone" | "computer" {
  if (!userAgent) return "computer";
  return /android|iphone|ipad|ipod|mobile|windows phone|opera mini|iemobile/i.test(userAgent) ? "phone" : "computer";
}

// ---------- After the event ----------

/** Same rule as the database CHECK: an address of THIS site, never a scheme or "//host". */
export function isSafeInternalPath(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length <= 200 && /^\/([A-Za-z0-9_-][A-Za-z0-9/_.~%=&?#-]*)?$/.test(value);
}

/**
 * The page a path lands on, for comparisons: no query, no fragment, no
 * trailing slash, and `/ao-vivo/<legacy>` folded into its legacy address — so
 * "/lei-15345?x=1", "/lei-15345/" and "/ao-vivo/lei-15345" are all the SAME
 * page as "/lei-15345" (a redirect from it to any of them would loop).
 */
export function normalizeInternalPath(path: string): string {
  const bare = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const slug = bare.match(/^\/ao-vivo\/([a-z0-9-]+)$/)?.[1];
  return slug && LEGACY_EVENT_PATHS[slug] ? LEGACY_EVENT_PATHS[slug] : bare;
}

/** The event a path is the page of, if it is one: "/ao-vivo/x" → "x", "/lei-15345" → "lei-15345". */
export function eventSlugFromPath(path: string): string | null {
  const page = normalizeInternalPath(path);
  const legacy = Object.entries(LEGACY_EVENT_PATHS).find(([, legacyPath]) => legacyPath === page)?.[0];
  if (legacy) return legacy;
  const slug = page.match(/^\/ao-vivo\/([a-z0-9-]+)$/)?.[1];
  return slug && EVENT_SLUG_SHAPE.test(slug) ? slug : null;
}

// ---------- Measurement ----------

/**
 * The same spelling of a channel as the database's `live_event_channel`: lower
 * case, letters, digits, "_" and "-", at most 32 characters, "direto" when
 * nothing is left. Visits and registrations must agree on it.
 */
export function normalizeChannel(value: string | null | undefined): string {
  const clean = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 32);
  return clean || "direto";
}

/** "Uma noite" / "Uma tarde" / "Uma manhã" from the start hour in Brasília; "Um encontro" without a date. */
export function eventDaypart(iso: string | null): string {
  if (!iso) return "Um encontro";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Um encontro";
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(date),
  );
  return hour < 12 ? "Uma manhã" : hour < 18 ? "Uma tarde" : "Uma noite";
}

// ---------- Page content ----------

export const TOPIC_ICON_KEYS = [
  "lei",
  "apresentacao",
  "consulta",
  "conversa",
  "livro",
  "grafico",
  "pessoas",
  "coracao",
  "folha",
  "video",
] as const;

export type TopicIconKey = (typeof TOPIC_ICON_KEYS)[number];

export type EventTopic = { icon: TopicIconKey; text: string };

export const TOPIC_ICON_LABELS: Record<TopicIconKey, string> = {
  lei: "Lei, norma",
  apresentacao: "Apresentação",
  consulta: "Consulta, demonstração",
  conversa: "Conversa, perguntas",
  livro: "Estudo, livro",
  grafico: "Números, gráfico",
  pessoas: "Pessoas, comunidade",
  coracao: "Cuidado",
  folha: "Natureza, fitoterapia",
  video: "Vídeo",
};

/** The topics column, trusted only as far as its shape: anything malformed is dropped. */
export function readEventTopics(value: unknown): EventTopic[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is EventTopic =>
        Boolean(item) &&
        typeof item === "object" &&
        (TOPIC_ICON_KEYS as readonly string[]).includes((item as EventTopic).icon) &&
        typeof (item as EventTopic).text === "string" &&
        (item as EventTopic).text.trim().length > 0,
    )
    .slice(0, 3);
}

/** "um assunto" / "dois assuntos" / "três assuntos". */
export function topicsCountLabel(count: number): string {
  return ["", "um assunto", "dois assuntos", "três assuntos"][count] ?? `${count} assuntos`;
}

export const DEFAULT_BYLINE = "com Debora Giovanella, fundadora do MedChina";

/** The same limits as `live_events_content_lengths` (migration 0113). */
export const EVENT_CONTENT_LIMITS = {
  title: 200,
  pageTitle: 120,
  topic: 80,
  headline: 220,
  byline: 140,
  lead: 600,
  audienceHeading: 140,
  audience: 600,
  description: 200,
  topicText: 200,
} as const;
