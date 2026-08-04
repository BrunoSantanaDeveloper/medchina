import { settleDueBillingCancellations } from "@/lib/billing-cancellation";
import { expireStaleBillingLeases, retireAbandonedCheckouts } from "@/lib/billing-maintenance";
import { inngest } from "@flyee/jobs";

export const settleBillingCancellationsFunction = inngest.createFunction(
  { id: "medchina-settle-billing-cancellations" },
  { cron: "*/15 * * * *" },
  async () => settleDueBillingCancellations(),
);

/**
 * Nightly sweep of the two things that leak when a request dies mid-flight:
 * leases nobody released, and checkouts nobody finished (which on Asaas are
 * live recurring charges billing someone who never contracted them). Both are
 * idempotent, so a retried run costs nothing.
 */
export const billingMaintenanceFunction = inngest.createFunction(
  { id: "medchina-billing-maintenance" },
  { cron: "20 4 * * *" },
  async () => {
    const leases = await expireStaleBillingLeases();
    const checkouts = await retireAbandonedCheckouts();
    return { leases, checkouts };
  },
);

export const billingFunctions = [settleBillingCancellationsFunction, billingMaintenanceFunction];
