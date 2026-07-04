# @flyee/connectors

Framework for **per-organization connections to external APIs** (ad platforms, CRMs, ERPs...). The template ships the plumbing — connection records, secret storage, sync orchestration, a settings UI — and **zero concrete connectors**: each derived project registers its own.

## Model

- `connections` — org-scoped row per external account: provider slug, status, non-secret `metadata`, incremental `sync_cursor`, `last_synced_at`, `sync_error`. RLS: members read, owners/admins manage.
- `connection_secrets` — tokens/API keys. RLS enabled with **no policies**: only the service role reads them; they never reach the browser.

## Writing a connector (derived project)

```ts
import { registerConnector, type Connector } from "@flyee/connectors";

const metaAds: Connector = {
  provider: "meta-ads",
  name: "Meta Ads",
  secretFields: [{ key: "access_token", label: "System user access token" }],
  async test(secret) {
    // Call the provider; return { ok, metadata: { account_id, ... } } or { ok: false, error }.
  },
  async sync({ connection, secret, supabase }) {
    // Fetch since connection.sync_cursor, write normalized rows to your
    // project's tables via the service client, return { cursor, stats }.
  },
};

registerConnector(metaAds);
```

Register at module scope in `apps/web/src/lib/connectors.ts` (created by the derived project) and import that file from both `/settings/connections/actions.ts` and `/api/inngest/route.ts`, so the registry is populated in every server context that needs it.

## Sync paths

- Manual: "Sync now" in `/settings/connections` → authorizes via an RLS-scoped write, then queues `connectors/connection.sync` (inline `runConnectionSync` fallback when Inngest is unreachable).
- Scheduled: add a cron Inngest function in the derived project that lists due connections and fans out one `connectors/connection.sync` event each.

## OAuth-based providers

`secretFields` covers key/token credentials. For OAuth, the derived project implements the redirect/callback routes and calls `saveConnectionSecret(connectionId, tokens)` from the callback; everything downstream (sync, refresh inside `sync()`) is unchanged.
