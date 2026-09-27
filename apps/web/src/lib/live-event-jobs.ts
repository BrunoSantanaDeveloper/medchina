import "server-only";

import { liveEventService } from "@/lib/live-event";
import { sendLiveEventEmails } from "@/lib/live-event-email";
import { inngest } from "@flyee/jobs";

/**
 * Background work of the live event (docs/PAGINA-EVENTO.md §8, §9).
 *
 * 1. The reminder e-mails, fired by the /admin/leads buttons. The console falls
 *    back to calling `sendLiveEventEmails` inline when Inngest cannot take the
 *    event (sendEvent never throws); either path is idempotent.
 * 2. Retention, once a day: `purge_expired_leads()` erases leads without the
 *    optional news consent six months after their last event — rows AND their
 *    versions (migration 0112). The policy promises it (privacy-8), so it runs
 *    by itself, not when someone remembers.
 */

/** 04:00 in São Paulo (UTC-3): nobody is registering at that hour. */
const RETENTION_CRON = "0 7 * * *";

export const liveEventEmailFunction = inngest.createFunction(
  { id: "live-event-email", retries: 1, concurrency: { limit: 1 } },
  { event: "medchina/live-event.email" },
  async ({ event, step }) =>
    step.run("send", async () => sendLiveEventEmails({ eventId: event.data.eventId, kind: event.data.kind })),
);

export const leadRetentionFunction = inngest.createFunction(
  { id: "lead-retention", retries: 1, concurrency: { limit: 1 } },
  { cron: RETENTION_CRON },
  async ({ step }) =>
    step.run("purge-expired-leads", async () => {
      const service = liveEventService();
      if (!service) return { ok: false, reason: "service_unavailable" };
      const { data, error } = await service.rpc("purge_expired_leads");
      if (error) return { ok: false, error: error.message };
      return data as { ok: boolean; removed: number };
    }),
);

export const liveEventFunctions = [liveEventEmailFunction, leadRetentionFunction];
