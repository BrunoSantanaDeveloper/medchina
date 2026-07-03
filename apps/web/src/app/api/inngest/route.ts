import { inngest } from "@gogo/jobs";
import { serve } from "@gogo/jobs/next";

// Register every Inngest function exposed by packages/* here.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [],
});
