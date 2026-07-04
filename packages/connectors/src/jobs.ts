import { inngest } from "@flyee/jobs";

import { runConnectionSync } from "./sync";

/** Background sync — triggered by sendEvent("connectors/connection.sync") or a cron fan-out. */
export const connectionSyncFunction = inngest.createFunction(
  { id: "connectors-connection-sync", retries: 2, concurrency: { limit: 5 } },
  { event: "connectors/connection.sync" },
  async ({ event }) => {
    const result = await runConnectionSync(event.data.connectionId);
    if (!result.ok) throw new Error(result.error);
    return result;
  },
);

export const connectorFunctions = [connectionSyncFunction];
