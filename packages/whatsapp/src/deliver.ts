import type { SupabaseClient } from "@supabase/supabase-js";

import { getWhatsAppProvider } from "./registry";
import type { TemplateMessage } from "./types";

export type DeliverResult = { ok: true } | { ok: false; error: string };

/**
 * Send one queued wa_messages row through the configured provider and
 * record the outcome. Skips rows that are no longer queued (canceled or
 * already sent), so job retries and the inline fallback stay idempotent.
 */
export async function deliverMessage(supabase: SupabaseClient, messageId: string): Promise<DeliverResult> {
  const { data: message, error: loadError } = await supabase
    .from("wa_messages")
    .select("id, status, to_number, kind, text, template, template_params")
    .eq("id", messageId)
    .maybeSingle();
  if (loadError || !message) return { ok: false, error: loadError?.message ?? "Message not found." };
  if (message.status !== "queued") return { ok: true };

  const fail = async (error: string) => {
    await supabase.from("wa_messages").update({ status: "failed", error }).eq("id", messageId);
    return { ok: false as const, error };
  };

  let provider;
  try {
    provider = getWhatsAppProvider();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (!message.to_number) return fail("Message has no destination number.");

  const result =
    message.kind === "template" && message.template
      ? await provider.sendTemplate(message.to_number, {
          name: message.template,
          ...((message.template_params as Omit<TemplateMessage, "name"> | null) ?? {}),
        })
      : await provider.sendText(message.to_number, message.text ?? "");

  if (!result.ok) return fail(result.error);

  await supabase
    .from("wa_messages")
    .update({
      status: "sent",
      provider: provider.name,
      provider_message_id: result.providerMessageId ?? null,
      sent_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", messageId);
  return { ok: true };
}
