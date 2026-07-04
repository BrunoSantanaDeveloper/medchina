import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEvent } from "@gogo/jobs";

import { deliverMessage } from "./deliver";
import type { TemplateMessage } from "./types";

export interface SendWhatsAppInput {
  orgId: string;
  /** Destination number, digits with country code (e.g. "5511999999999"). */
  to: string;
  /** Free-form text (Meta: only inside the 24h customer-service window). */
  text?: string;
  /** Pre-approved template (Meta) — Evolution sends its fallbackText. */
  template?: TemplateMessage;
  /** Future timestamp = scheduled send (requires Inngest to be reachable). */
  sendAt?: Date | string;
  createdBy?: string;
  /** Project context (e.g. { appointmentId }) — echoed back on replies. */
  metadata?: Record<string, unknown>;
}

export type SendWhatsAppResult =
  | { ok: true; messageId: string; queued: boolean }
  | { ok: false; error: string; messageId?: string };

/**
 * Log + dispatch one WhatsApp message. Works for the three trigger modes:
 * manual (server action), automatic (any server code) and scheduled
 * (sendAt in the future — the Inngest job sleeps until then). Immediate
 * sends fall back to inline delivery when Inngest is unreachable;
 * scheduled sends cannot (nothing would wake up to deliver them).
 */
export async function sendWhatsApp(supabase: SupabaseClient, input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  if (!input.text && !input.template) return { ok: false, error: "Provide text or template." };

  const sendAt = input.sendAt ? new Date(input.sendAt) : null;
  const { data: created, error: insertError } = await supabase
    .from("wa_messages")
    .insert({
      org_id: input.orgId,
      direction: "out",
      to_number: input.to.replace(/\D/g, ""),
      kind: input.template ? "template" : "text",
      text: input.text ?? input.template?.fallbackText ?? null,
      template: input.template?.name ?? null,
      template_params: input.template
        ? { language: input.template.language, bodyParams: input.template.bodyParams, fallbackText: input.template.fallbackText }
        : null,
      send_at: sendAt?.toISOString() ?? null,
      metadata: input.metadata ?? {},
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (insertError || !created) return { ok: false, error: insertError?.message ?? "Insert failed." };

  const queued = await sendEvent("whatsapp/message.send", { messageId: created.id });
  if (queued.sent) return { ok: true, messageId: created.id, queued: true };

  if (sendAt && sendAt.getTime() > Date.now()) {
    const error = `Scheduled sends need Inngest: ${queued.hint}`;
    await supabase.from("wa_messages").update({ status: "failed", error }).eq("id", created.id);
    return { ok: false, error, messageId: created.id };
  }

  const delivered = await deliverMessage(supabase, created.id);
  return delivered.ok
    ? { ok: true, messageId: created.id, queued: false }
    : { ok: false, error: delivered.error, messageId: created.id };
}

/** Cancel a still-queued (typically scheduled) message before delivery. */
export async function cancelWhatsAppMessage(
  supabase: SupabaseClient,
  messageId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("wa_messages")
    .update({ status: "canceled" })
    .eq("id", messageId)
    .eq("status", "queued");
  return error ? { ok: false, error: error.message } : { ok: true };
}
