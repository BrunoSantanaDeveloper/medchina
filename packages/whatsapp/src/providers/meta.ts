import { createHmac, timingSafeEqual } from "node:crypto";

import type { SendResult, TemplateMessage, WhatsAppProvider, WhatsAppWebhookEvent } from "../types";

/**
 * Meta WhatsApp Cloud API (official). Business-initiated messages require a
 * template pre-approved in the Meta business panel; free-form text is only
 * accepted inside the 24h customer-service window after the user's last
 * message. Webhook: subscribe the app to the "messages" field and point it
 * at /api/webhooks/whatsapp/meta.
 */
export class MetaProvider implements WhatsAppProvider {
  readonly name = "meta" as const;

  private endpoint() {
    const token = process.env.WHATSAPP_META_TOKEN;
    const phoneId = process.env.WHATSAPP_META_PHONE_ID;
    if (!token || !phoneId) {
      throw new Error("WHATSAPP_META_TOKEN and WHATSAPP_META_PHONE_ID must be set");
    }
    const version = process.env.WHATSAPP_META_API_VERSION || "v23.0";
    return { url: `https://graph.facebook.com/${version}/${phoneId}/messages`, token };
  }

  private async post(payload: Record<string, unknown>): Promise<SendResult> {
    let endpoint;
    try {
      endpoint = this.endpoint();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });

    const data = (await response.json().catch(() => null)) as {
      messages?: { id: string }[];
      error?: { message?: string };
    } | null;

    if (!response.ok) {
      return { ok: false, error: data?.error?.message ?? `Meta request failed (${response.status})` };
    }
    return { ok: true, providerMessageId: data?.messages?.[0]?.id };
  }

  sendText(to: string, text: string): Promise<SendResult> {
    return this.post({ to, type: "text", text: { body: text } });
  }

  sendTemplate(to: string, template: TemplateMessage): Promise<SendResult> {
    return this.post({
      to,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language ?? "pt_BR" },
        ...(template.bodyParams?.length
          ? {
              components: [
                {
                  type: "body",
                  parameters: template.bodyParams.map((value) => ({ type: "text", text: value })),
                },
              ],
            }
          : {}),
      },
    });
  }

  /** GET handshake: Meta sends hub.verify_token and expects hub.challenge back. */
  verifyWebhook(request: Request): Response | null {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || !challenge) return null;
    if (!process.env.WHATSAPP_META_VERIFY_TOKEN || token !== process.env.WHATSAPP_META_VERIFY_TOKEN) {
      return new Response("Verification failed", { status: 403 });
    }
    return new Response(challenge, { status: 200 });
  }

  /**
   * Authenticates a webhook POST with the HMAC Meta signs every payload with
   * (`X-Hub-Signature-256`, keyed by the app secret).
   *
   * Without this the endpoint accepted any POST that reached it, and the URL is
   * guessable (/api/webhooks/whatsapp/meta, public by necessity): anyone could
   * forge delivery statuses and INBOUND messages straight into the database.
   * That is inert while nothing consumes inbound — and becomes injection of
   * clinical-operational state the moment a patient's "SIM" confirms an
   * appointment.
   *
   * Compared in constant time: a fast-exit comparison leaks the prefix and
   * turns forgery into a guessing game.
   */
  verifySignature(rawBody: string, headers: Headers): "ok" | "invalid" | "unconfigured" {
    const secret = process.env.WHATSAPP_META_APP_SECRET;
    if (!secret) return "unconfigured";

    const header = headers.get("x-hub-signature-256") ?? "";
    const provided = header.startsWith("sha256=") ? header.slice(7) : "";
    if (!/^[0-9a-f]{64}$/i.test(provided)) return "invalid";

    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const providedBuffer = Buffer.from(provided.toLowerCase(), "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (providedBuffer.length !== expectedBuffer.length) return "invalid";
    return timingSafeEqual(providedBuffer, expectedBuffer) ? "ok" : "invalid";
  }

  parseWebhook(body: unknown): WhatsAppWebhookEvent[] {
    const events: WhatsAppWebhookEvent[] = [];
    const payload = body as {
      entry?: {
        changes?: {
          value?: {
            statuses?: { id: string; status: string; errors?: { message?: string; title?: string }[] }[];
            messages?: {
              id: string;
              from: string;
              text?: { body?: string };
              button?: { text?: string };
              interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
            }[];
          };
        }[];
      }[];
    };

    for (const entry of payload?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const status of change.value?.statuses ?? []) {
          if (["sent", "delivered", "read", "failed"].includes(status.status)) {
            events.push({
              type: "status",
              providerMessageId: status.id,
              status: status.status as "sent" | "delivered" | "read" | "failed",
              error: status.errors?.[0]?.message ?? status.errors?.[0]?.title,
            });
          }
        }
        for (const message of change.value?.messages ?? []) {
          // Button/list replies (confirmation taps) arrive as their label.
          const text =
            message.text?.body ??
            message.button?.text ??
            message.interactive?.button_reply?.title ??
            message.interactive?.list_reply?.title ??
            "";
          events.push({ type: "message", from: message.from, text, providerMessageId: message.id });
        }
      }
    }
    return events;
  }
}
