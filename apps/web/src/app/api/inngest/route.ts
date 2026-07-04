import "@/lib/connectors";

import { connectorFunctions } from "@gogo/connectors/jobs";
import { inngest } from "@gogo/jobs";
import { serve } from "@gogo/jobs/next";
import { knowledgeFunctions } from "@gogo/knowledge/jobs";
import { transcribeFunctions } from "@gogo/transcribe/jobs";
import { whatsappFunctions } from "@gogo/whatsapp/jobs";

// Register every Inngest function exposed by packages/* here.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...knowledgeFunctions, ...connectorFunctions, ...transcribeFunctions, ...whatsappFunctions],
});
