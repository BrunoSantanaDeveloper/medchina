import "@/lib/connectors";

// The recording pipeline (download + transcribe + extract + apply) runs in ONE
// invocation of this route when queued, so it needs the REAL ceiling — not the
// 300s platform DEFAULT that a long consultation kept dying against. 800s is
// the documented maximum for this plan (Pro/Enterprise, nodejs24.x). The
// pipeline's own deadline stops well short of it, so WE end the work and record
// why, instead of the platform killing the process before anything is written —
// which is what left recordings stranded in 'processing' with a live lease.
export const maxDuration = 800;

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
