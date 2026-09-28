/**
 * Shapes and labels shared by the events console (/admin/eventos). Admin copy
 * is hardcoded pt-BR by the repo's rule (apps/web/CLAUDE.md, superadmin bullet).
 */

export type EventState = "rascunho" | "inscricoes" | "ao_vivo" | "encerrado";

export type ConsoleEvent = {
  id: string;
  slug: string;
  title: string;
  starts_at: string | null;
  duration_minutes: number | null;
  state: EventState;
  owner_phone: string | null;
  group_invite_url: string | null;
  stream_url: string | null;
  recording_url: string | null;
  ip_window_limit: number;
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
  updated_at: string;
  page_title: string | null;
  offer_angle: string | null;
  published_at: string | null;
};

export const EVENT_SELECT =
  "id, slug, title, starts_at, duration_minutes, state, owner_phone, group_invite_url, stream_url, recording_url, ip_window_limit, " +
  "topic, headline, byline, lead, lead_after, topics, audience_heading, audience, description, ended_behavior, ended_redirect_path, archived_at, updated_at, " +
  "page_title, offer_angle, published_at";

/** One row of `live_events_overview()` (migration 0113). */
export type EventOverview = {
  id: string;
  slug: string;
  title: string;
  state: EventState;
  starts_at: string | null;
  archived_at: string | null;
  updated_at: string;
  registrations: number;
  present: number;
  visits: number;
  purchases: number;
};

/** `live_event_results(event)` (migration 0113). */
export type EventResults = {
  ok: boolean;
  registrations: number;
  after_event: number;
  group_clicked: number;
  group_phone: number;
  group_computer: number;
  whatsapp_started: number;
  present: number;
  watched_20: number;
  visits: number;
  channels: { channel: string; visits: number; registrations: number }[];
  purchases: number;
  revenue_cents: number;
  emails: Record<"confirmation" | "day_before" | "hour_before" | "live" | "recording", number>;
};

export const STATE_LABEL: Record<EventState, string> = {
  rascunho: "Rascunho",
  inscricoes: "Inscrições abertas",
  ao_vivo: "Ao vivo",
  encerrado: "Encerrado",
};

export const STATE_OPTIONS: { value: EventState; label: string }[] = [
  { value: "rascunho", label: "Rascunho · a página responde 404 (só superadmin vê a prévia)" },
  { value: "inscricoes", label: "Inscrições abertas · convite e formulário" },
  { value: "ao_vivo", label: "Ao vivo · a página vira a sala" },
  { value: "encerrado", label: "Encerrado · o que acontece depois é escolhido abaixo" },
];

const WHEN = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** "8 de outubro de 2026 às 20:00" — or the reason there is no date. */
export function eventWhen(iso: string | null): string {
  if (!iso) return "Sem data";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Sem data" : WHEN.format(date);
}

/** Brazil has had no daylight saving since 2019: Brasília is UTC−3 all year. */
export function toBrasiliaInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromBrasiliaInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "12,4%" — or "—" when there is no denominator yet. */
export function percent(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
