import "server-only";

/**
 * GA4 Measurement Protocol — server-side conversion events, the Google
 * counterpart to lib/meta-capi.ts.
 *
 * Same compliance shape as the Meta CAPI: the money funnel happens inside the
 * authenticated app where no gtag runs (health-data rule), so these events are
 * sent from the server. They carry NO patient/clinical data — only the
 * commercial action and, for stitching, the visitor's GA4 `client_id`.
 *
 * `client_id` is REQUIRED by the protocol and only exists once the visitor
 * accepted analytics on the marketing site (that is when gtag set the `_ga`
 * cookie). So "no client_id → no event" is both a technical constraint and the
 * correct consent behaviour: we never fabricate a GA4 user for someone who did
 * not consent. Graceful + best-effort: no config or no client_id = no-op.
 */

const MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA4_ID?.trim() || null;
const API_SECRET = process.env.GA4_API_SECRET?.trim() || null;

export function isGa4MpConfigured(): boolean {
  return Boolean(MEASUREMENT_ID && API_SECRET);
}

/**
 * Extracts the GA4 `client_id` from a `_ga` cookie value.
 * `GA1.1.1234567890.1700000000` → `1234567890.1700000000`.
 */
export function gaClientIdFromCookie(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /^GA\d+\.\d+\.(\d+\.\d+)$/.exec(raw.trim());
  return match ? match[1] : null;
}

export type Ga4EventName =
  | "sign_up"
  | "start_trial"
  | "begin_checkout"
  | "purchase"
  | "subscribe"
  | "activated"
  | "trial_expiring";

export interface Ga4EventInput {
  clientId: string | null;
  eventName: Ga4EventName;
  params?: Record<string, unknown>;
  /** GA4 dedups by (client_id, event_name, timestamp_micros); pass the invoice
   * id etc. so retries collapse. */
  eventId?: string;
  /** Unix seconds; converted to the micros the protocol expects. */
  eventTime?: number;
}

export async function sendGa4Event(input: Ga4EventInput): Promise<void> {
  if (!isGa4MpConfigured() || !input.clientId) return;
  try {
    const body: Record<string, unknown> = {
      client_id: input.clientId,
      events: [
        {
          name: input.eventName,
          params: {
            ...(input.eventId ? { event_id: input.eventId } : {}),
            ...input.params,
          },
        },
      ],
    };
    if (input.eventTime) body.timestamp_micros = input.eventTime * 1_000_000;

    const response = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    // MP returns 204 with no body on success; anything else is worth a line.
    if (!response.ok) {
      console.warn("ga4_mp_send_failed", { status: response.status, event: input.eventName });
    }
  } catch {
    // Measurement must never break the money/auth path.
  }
}
