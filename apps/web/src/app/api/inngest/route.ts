import "@/lib/connectors";

import { connectorFunctions } from "@gogo/connectors/jobs";
import { inngest } from "@gogo/jobs";
import { serve } from "@gogo/jobs/next";
import { knowledgeFunctions } from "@gogo/knowledge/jobs";

// Register every Inngest function exposed by packages/* here.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...knowledgeFunctions, ...connectorFunctions],
});
