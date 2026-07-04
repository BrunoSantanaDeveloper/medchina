import "@/lib/connectors";

import { connectorFunctions } from "@flyee/connectors/jobs";
import { inngest } from "@flyee/jobs";
import { serve } from "@flyee/jobs/next";
import { knowledgeFunctions } from "@flyee/knowledge/jobs";
import { transcribeFunctions } from "@flyee/transcribe/jobs";
import { whatsappFunctions } from "@flyee/whatsapp/jobs";

// Register every Inngest function exposed by packages/* here.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...knowledgeFunctions, ...connectorFunctions, ...transcribeFunctions, ...whatsappFunctions],
});
