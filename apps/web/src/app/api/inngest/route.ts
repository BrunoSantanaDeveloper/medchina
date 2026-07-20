import "@/lib/connectors";

import { agendaFunctions } from "@/lib/agenda-jobs";
import { billingFunctions } from "@/lib/billing-jobs";
import { clinicalFunctions } from "@/lib/clinical-jobs";
import { backupFunctions } from "@flyee/backup/jobs";
import { connectorFunctions } from "@flyee/connectors/jobs";
import { inngest } from "@flyee/jobs";
import { serve } from "@flyee/jobs/next";
import { knowledgeFunctions } from "@flyee/knowledge/jobs";
import { transcribeFunctions } from "@flyee/transcribe/jobs";
import { whatsappFunctions } from "@flyee/whatsapp/jobs";

// Every Inngest function: the template packages plus MedChina's own.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ...agendaFunctions,
    ...billingFunctions,
    ...clinicalFunctions,
    ...knowledgeFunctions,
    ...connectorFunctions,
    ...transcribeFunctions,
    ...whatsappFunctions,
    ...backupFunctions,
  ],
});
