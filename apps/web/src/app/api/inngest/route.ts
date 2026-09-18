import "@/lib/connectors";

// The recording pipeline (download + transcribe + extract + apply) runs in ONE
// invocation of this route when queued. 300 is not a guess and not a default we
// could raise: this project is on the Vercel HOBBY plan, which REFUSES a deploy
// with any higher value ("must have a maxDuration between 1 and 300"). The
// pipeline's own deadline stops short of this, so WE end the work and record
// why, instead of the platform killing the process before anything is written —
// which is what left recordings stranded in 'processing' with a live lease.
export const maxDuration = 300;

import { accountExportFunctions } from "@/lib/account-export-jobs";
import { adminFunctions } from "@/lib/admin-jobs";
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
    ...adminFunctions,
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
