import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

import { deliverMessage } from "./deliver";

/**
 * Delivery job — immediate sends run straight through; scheduled sends
 * sleep until send_at (deliverMessage skips rows canceled meanwhile).
 */
export const whatsappSendFunction = inngest.createFunction(
  { id: "whatsapp-message-send", retries: 3, concurrency: { limit: 5 } },
  { event: "whatsapp/message.send" },
  async ({ event, step }) => {
    const sendAt = await step.run("load-schedule", async () => {
      const supabase = createServiceClient();
      const { data } = await supabase
        .from("wa_messages")
        .select("send_at")
        .eq("id", event.data.messageId)
        .maybeSingle();
      return data?.send_at ?? null;
    });

    if (sendAt && new Date(sendAt).getTime() > Date.now()) {
      await step.sleepUntil("wait-until-send-at", new Date(sendAt));
    }

    return step.run("deliver", async () => {
      const supabase = createServiceClient();
      const result = await deliverMessage(supabase, event.data.messageId);
      if (!result.ok) throw new Error(result.error);
      return result;
    });
  },
);

export const whatsappFunctions = [whatsappSendFunction];
