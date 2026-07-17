import { settleDueBillingCancellations } from "@/lib/billing-cancellation";
import { inngest } from "@flyee/jobs";

export const settleBillingCancellationsFunction = inngest.createFunction(
  { id: "medchina-settle-billing-cancellations" },
  { cron: "*/15 * * * *" },
  async () => settleDueBillingCancellations(),
);

export const billingFunctions = [settleBillingCancellationsFunction];
