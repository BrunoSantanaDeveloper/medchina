import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

import { processDocument } from "./ingest";

/** Background ingestion — triggered by sendEvent("knowledge/document.ingest"). */
export const knowledgeIngestFunction = inngest.createFunction(
  { id: "knowledge-document-ingest", retries: 3 },
  { event: "knowledge/document.ingest" },
  async ({ event }) => {
    const supabase = createServiceClient();
    const result = await processDocument(supabase, event.data.documentId);
    if (!result.ok) throw new Error(result.error);
    return result;
  },
);

export const knowledgeFunctions = [knowledgeIngestFunction];
