import "@/lib/connectors";

import { accountExportFunctions } from "@/lib/account-export-jobs";
import { agendaFunctions } from "@/lib/agenda-jobs";
import { billingFunctions } from "@/lib/billing-jobs";
import { clinicalFunctions } from "@/lib/clinical-jobs";
import { importFunctions } from "@/lib/import-jobs";
import { trialFunctions } from "@/lib/trial-jobs";
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
    ...accountExportFunctions,
    ...clinicalFunctions,
    ...importFunctions,
    ...trialFunctions,
    ...knowledgeFunctions,
    ...connectorFunctions,
    ...transcribeFunctions,
    ...whatsappFunctions,
    ...backupFunctions,
  ],
});
