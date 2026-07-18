# @flyee/db

Multi-tenant database layer for Supabase Postgres: Drizzle schema, SQL migrations with RLS, and a typed server-side client.

## Model

- `profiles` — one row per auth user, auto-created by the `handle_new_user` trigger. Signup metadata `company` also bootstraps the user's first organization (owner membership).
- `organizations` / `memberships` — multi-tenancy core; roles: `owner`, `admin`, `member`.
- `invites` — token-based org invitations; accepted via the `accept_invite(token)` RPC.

RLS is enabled on every table from day 1. Regular users create orgs through the `create_organization(name, slug)` RPC (security definer), never by direct insert.

## Applying migrations

Migrations live in `migrations/` as plain SQL. With the Supabase CLI linked to your project:

```bash
supabase db push            # or copy into supabase/migrations of the derived project
```

Or run them directly with psql against the project database.

This derived project records applied files in `public.schema_migrations`. When
Docker is not part of the development environment, the root commands below use
the remote `DATABASE_URL` from `apps/web/.env` without printing credentials:

```bash
npm run db:plan:remote     # read-only list of pending migrations
npm run db:migrate:remote  # transactional migrations with an advisory lock
npm run test:db:remote     # transactional pgTAP suite against the current schema
npm run db:gate:remote     # migrate, then run pgTAP
```

The remote runner refuses localhost targets, applies only files absent from the
existing history, and records a migration only in the same transaction as its
SQL. Its pgTAP protocol runner connects directly with Postgres and does not use
Docker. The test files use `BEGIN`/`ROLLBACK`, so their synthetic clinical rows
do not persist.

**Privilege baseline (local/CI):** the hosted project predates Supabase's 2025
"secure by default" change, so there every object a migration creates is
granted to `anon`/`authenticated`/`service_role` automatically, and migrations
narrow that with explicit revokes (0029/0030/0031/0035/0039/0040/0041…). Newer
local images ship without those default grants, which would silently produce a
different privilege model. `npm run db:prepare` therefore generates
`supabase/migrations/00000000000000_legacy_default_privileges.sql`, restoring
the legacy default privileges before the first migration runs. If a NEW hosted
project is ever created, apply that same baseline there before migrating.

## Usage

```ts
import { createDb, organizations } from "@flyee/db";

const db = createDb(); // uses DATABASE_URL (Supabase pooler, port 6543)
const orgs = await db.select().from(organizations);
```

**RLS caveat:** `createDb` connects with the `DATABASE_URL` role and bypasses RLS when that role is privileged. Use it in trusted server code only and scope queries by organization. Browser/user-scoped access goes through the Supabase client from `@flyee/auth`, which enforces RLS via the user's JWT.

## Evolving the schema

1. Edit `src/schema/*` (Drizzle definitions).
2. `npm run generate -w @flyee/db` to produce the next SQL migration (requires `DATABASE_URL`), or write the SQL by hand in `migrations/`.
3. Keep RLS policies in the same migration as the tables they protect.
