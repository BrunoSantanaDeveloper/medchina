# @gogo/jobs

Background jobs, queues and cron via [Inngest](https://www.inngest.com), shared by every package that needs async work.

## Concept

One Inngest client (`inngest`, app id `gogo`) with a typed event map (`JobEvents`). Packages that need async processing declare their event in `JobEvents`, define their functions in their own `src/jobs.ts` (packages may depend on packages, never on apps), and `apps/web/src/app/api/inngest/route.ts` serves the aggregated function list.

## Graceful degradation

`sendEvent(name, data)` never throws — it returns `{ sent: false, hint }` when Inngest is unreachable. **Callers must offer an inline fallback** (same rule as `@gogo/email`): e.g. knowledge ingestion processes the document synchronously when the event cannot be queued.

## Local dev

```
npx inngest-cli dev
```

No keys needed locally; the SDK auto-discovers the dev server and the route at `/api/inngest`.

## Production (Vercel)

Set in the Vercel project (or `apps/web/.env`):

```
INNGEST_EVENT_KEY=      # Inngest dashboard > Events
INNGEST_SIGNING_KEY=    # Inngest dashboard > Signing key
```

Then register the app URL (`https://<domain>/api/inngest`) in the Inngest dashboard. The [Vercel integration](https://www.inngest.com/docs/deploy/vercel) automates both.

## Adding a job

1. Add the event to `JobEvents` in `src/index.ts`.
2. Create the function in the owning package:

```ts
import { inngest } from "@gogo/jobs";

export const myJob = inngest.createFunction(
  { id: "my-job", retries: 3 },
  { event: "my-package/thing.happened" },
  async ({ event, step }) => {
    /* steps are retried independently */
  },
);
```

3. Append it to the `functions` array in `apps/web/src/app/api/inngest/route.ts`.

Cron: use `{ cron: "0 6 * * *" }` as the trigger instead of an event.
