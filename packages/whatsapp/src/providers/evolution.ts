import type { SendResult, TemplateMessage, WhatsAppProvider, WhatsAppWebhookEvent } from "../types";

/** "5511999999999@s.whatsapp.net" -> "5511999999999" */
const digitsOnly = (jid: string) => jid.split("@")[0].replace(/\D/g, "");

/**
 * Evolution API (unofficial, self-hosted — https://doc.evolution-api.com).
 * Pragmatic option for MVPs: a regular WhatsApp number via QR pairing, no
 * template approval, free-form text anytime. Trade-off: it violates the
 * WhatsApp ToS and the number CAN be banned — use the Meta provider for
 * anything serious. Templates are sent as their fallbackText.
 * Point the instance webhook at /api/webhooks/whatsapp/evolution
 * (enable the MESSAGES_UPSERT and MESSAGES_UPDATE events).
 */
export class EvolutionProvider implements WhatsAppProvider {
  readonly name = "evolution" as const;

  private config() {
    const baseUrl = process.env.EVOLUTION_BASE_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    const instance = process.env.EVOLUTION_INSTANCE;
    if (!baseUrl || !apiKey || !instance) {
      throw new Error("EVOLUTION_BASE_URL, EVOLUTION_API_KEY and EVOLUTION_INSTANCE must be set");
    }
    return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, instance };
  }

  async sendText(to: string, text: string): Promise<SendResult> {
    let config;
    try {
      config = this.config();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const response = await fetch(`${config.baseUrl}/message/sendText/${config.instance}`, {
      method: "POST",
      headers: { apikey: config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number: to, text }),
    });

    const data = (await response.json().catch(() => null)) as { key?: { id?: string }; message?: string } | null;
    if (!response.ok) {
      return { ok: false, error: data?.message ?? `Evolution request failed (${response.status})` };
    }
    return { ok: true, providerMessageId: data?.key?.id };
  }

  sendTemplate(to: string, template: TemplateMessage): Promise<SendResult> {
    if (!template.fallbackText) {
      return Promise.resolve({
        ok: false,
        error: `Evolution has no native templates — provide template.fallbackText for "${template.name}".`,
      });
    }
    return this.sendText(to, template.fallbackText);
  }

  parseWebhook(body: unknown): WhatsAppWebhookEvent[] {
    const events: WhatsAppWebhookEvent[] = [];
    const payload = body as {
      event?: string;
      data?: {
        key?: { id?: string; remoteJid?: string; fromMe?: boolean };
        message?: { conversation?: string; extendedTextMessage?: { text?: string } };
        status?: string;
      };
    };
    const data = payload?.data;
    if (!payload?.event || !data) return events;

    const event = payload.event.toLowerCase().replace(/_/g, ".");

    if (event === "messages.upsert" && data.key && !data.key.fromMe) {
      const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? "";
      events.push({
        type: "message",
        from: digitsOnly(data.key.remoteJid ?? ""),
        text,
        providerMessageId: data.key.id,
      });
    }

    if (event === "messages.update" && data.key?.id && data.status) {
      const map: Record<string, "sent" | "delivered" | "read"> = {
        SERVER_ACK: "sent",
        DELIVERY_ACK: "delivered",
        READ: "read",
      };
      const status = map[data.status.toUpperCase()];
      if (status) events.push({ type: "status", providerMessageId: data.key.id, status });
    }

    return events;
  }
}
