import "server-only";

import { createHash } from "node:crypto";

/**
 * Meta Conversions API (CAPI) — server-side conversion events.
 *
 * Why server-side: the money funnel (checkout, trial start, purchase) happens
 * inside the AUTHENTICATED clinical app, where no browser Pixel is allowed to
 * run (LGPD Art. 11 — sensitive health data; see lib/analytics.ts). These
 * events are therefore sent from the server, carrying NO patient or clinical
 * data — only the professional's own commercial identifiers (hashed).
 *
 * Graceful degradation: with no `META_CAPI_TOKEN` configured this is a no-op,
 * exactly like every other flyee provider. Measurement must NEVER break the
 * money path, so every send is wrapped and failures are swallowed.
 *
 * Dedup: pass a stable `eventId`; if a browser Pixel later fires the same
 * event with the same `eventID`, Meta collapses the pair (§ event dedup).
 */

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || null;
const CAPI_TOKEN = process.env.META_CAPI_TOKEN?.trim() || null;
// Optional: a test-events code from Events Manager to verify wiring live.
const TEST_EVENT_CODE = process.env.META_CAPI_TEST_EVENT_CODE?.trim() || null;
const GRAPH_VERSION = "v21.0";

export function isMetaCapiConfigured(): boolean {
  return Boolean(PIXEL_ID && CAPI_TOKEN);
}

/** Meta requires SHA-256 of normalized (trimmed, lowercased) PII. */
function hashPii(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return createHash("sha256").update(normalized).digest("hex");
}

export type MetaEventName =
  | "Purchase"
  | "InitiateCheckout"
  | "StartTrial"
  | "Subscribe"
  | "Lead"
  | "CompleteRegistration"
  | "AddPaymentInfo";

export interface MetaConversionInput {
  eventName: MetaEventName;
  /** Stable id used to dedup with a browser event of the same name. */
  eventId: string;
  /** Unix seconds; defaults to now. Must be within Meta's 7-day window. */
  eventTime?: number;
  /** Where the browser event would have happened (marketing/app URL). */
  eventSourceUrl?: string | null;
  /** "website" when a request context exists; "system_generated" for webhooks. */
  actionSource?: "website" | "system_generated";

  // Match keys — all optional, more of them = better attribution.
  email?: string | null;
  /** Stable non-PII id (we use the org id) — hashed before sending. */
  externalId?: string | null;
  /** _fbp cookie value (set by the browser Pixel on the marketing site). */
  fbp?: string | null;
  /** _fbc cookie value (derived from the fbclid ad-click param). */
  fbc?: string | null;
  clientIp?: string | null;
  clientUserAgent?: string | null;

  // Commercial payload (never clinical).
  value?: number;
  currency?: string;
}

/** Reads the Meta match cookies + client hints from the current request. */
export interface MetaClientContext {
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  clientUserAgent?: string | null;
  eventSourceUrl?: string | null;
}

export async function sendMetaConversion(input: MetaConversionInput): Promise<void> {
  if (!isMetaCapiConfigured()) return;
  try {
    const userData: Record<string, unknown> = {};
    const em = hashPii(input.email);
    if (em) userData.em = [em];
    const externalId = hashPii(input.externalId);
    if (externalId) userData.external_id = [externalId];
    if (input.fbp) userData.fbp = input.fbp;
    if (input.fbc) userData.fbc = input.fbc;
    if (input.clientIp) userData.client_ip_address = input.clientIp;
    if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;

    const event: Record<string, unknown> = {
      event_name: input.eventName,
      event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
      event_id: input.eventId,
      action_source: input.actionSource ?? "website",
      user_data: userData,
    };
    if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;
    if (input.value !== undefined && input.currency) {
      event.custom_data = { value: input.value, currency: input.currency };
    }

    const body: Record<string, unknown> = { data: [event] };
    if (TEST_EVENT_CODE) body.test_event_code = TEST_EVENT_CODE;

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${CAPI_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      console.warn("meta_capi_send_failed", { status: response.status, event: input.eventName });
    }
  } catch {
    // Never let a measurement failure surface on the billing/auth path.
  }
}
