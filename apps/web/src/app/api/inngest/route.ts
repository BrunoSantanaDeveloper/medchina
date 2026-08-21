import "@/lib/connectors";

// The recording pipeline (download + transcribe + extract + apply) runs in ONE
// invocation of this route when queued. Without an explicit cap it runs under
// the Vercel plan default, which can kill a long transcription mid-flight —
// skipping the terminal failure update and stranding the row in 'processing'.
export const maxDuration = 300;

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
