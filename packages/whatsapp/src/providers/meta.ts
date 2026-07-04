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
