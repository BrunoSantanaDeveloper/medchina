import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEvent } from "@flyee/jobs";

import type { WhatsAppProviderName, WhatsAppWebhookEvent } from "./types";

/**
 * Persist normalized webhook events: status updates land on the matching
 * outbound row; inbound messages are logged (org resolved later by the
 * project's handler) and surfaced as "whatsapp/message.received" events.
 * Runs under the service client — webhooks have no user session.
 */
export async function handleWhatsAppWebhookEvents(
  supabase: SupabaseClient,
  provider: WhatsAppProviderName,
  events: WhatsAppWebhookEvent[],
): Promise<void> {
  for (const event of events) {
    if (event.type === "status") {
      // Never regress read -> delivered (webhooks can arrive out of order).
      const order = ["sent", "delivered", "read"];
      const { data: row } = await supabase
        .from("wa_messages")
        .select("id, status")
        .eq("provider", provider)
        .eq("provider_message_id", event.providerMessageId)
        .maybeSingle();
      if (!row) continue;
      const regression =
        event.status !== "failed" && order.indexOf(row.status) >= 0 && order.indexOf(event.status) <= order.indexOf(row.status);
      if (regression) continue;
      await supabase
        .from("wa_messages")
        .update({ status: event.status, ...(event.error ? { error: event.error } : {}) })
        .eq("id", row.id);
      continue;
    }

    const { data: inbound } = await supabase
      .from("wa_messages")
      .insert({
        direction: "in",
        from_number: event.from,
        kind: "text",
        text: event.text,
        status: "received",
        provider,
        provider_message_id: event.providerMessageId ?? null,
      })
      .select("id")
      .single();

    if (inbound) {
      // Derived projects subscribe to this event for business handling
      // (e.g. "patient replied to the confirmation template").
      await sendEvent("whatsapp/message.received", {
        messageId: inbound.id,
        from: event.from,
        text: event.text,
      });
    }
  }
}
