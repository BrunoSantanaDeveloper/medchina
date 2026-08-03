export type WhatsAppProviderName = "meta" | "evolution";

export interface TemplateMessage {
  /** Template name as registered/approved in the Meta business panel. */
  name: string;
  /** BCP-47-ish template language code (Meta), default "pt_BR". */
  language?: string;
  /** Positional {{1}}, {{2}}... body parameters. */
  bodyParams?: string[];
  /**
   * Plain-text rendering of the template. Required for providers without
   * native template support (Evolution) — they send this text instead.
   */
  fallbackText?: string;
}

export type SendResult = { ok: true; providerMessageId?: string } | { ok: false; error: string };

/** Normalized webhook payloads across providers. */
export type WhatsAppWebhookEvent =
  | {
      type: "status";
      providerMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
      error?: string;
    }
  | {
      type: "message";
      /** Sender number, digits only (e.g. "5511999999999"). */
      from: string;
      text: string;
      providerMessageId?: string;
    };

export interface WhatsAppProvider {
  readonly name: WhatsAppProviderName;
  sendText(to: string, text: string): Promise<SendResult>;
  sendTemplate(to: string, template: TemplateMessage): Promise<SendResult>;
  /** Handles the provider's GET verification handshake, when it has one. */
  verifyWebhook?(request: Request): Response | null;
  /**
   * Authenticates a webhook POST against the RAW body, for providers that sign
   * their payloads. Returns `"ok"` when the signature matches, `"invalid"` when
   * it does not, and `"unconfigured"` when the shared secret is absent — the
   * caller decides what an unconfigured verifier means (it must not silently
   * read as "verified"). Providers with no signature scheme omit this.
   */
  verifySignature?(rawBody: string, headers: Headers): "ok" | "invalid" | "unconfigured";
  /** Normalizes a webhook POST body into events (unknown shapes → []). */
  parseWebhook(body: unknown): WhatsAppWebhookEvent[];
}
