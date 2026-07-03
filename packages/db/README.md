# @gogo/db

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

## Usage

```ts
import { createDb, organizations } from "@gogo/db";

const db = createDb(); // uses DATABASE_URL (Supabase pooler, port 6543)
const orgs = await db.select().from(organizations);
```

**RLS caveat:** `createDb` connects with the `DATABASE_URL` role and bypasses RLS when that role is privileged. Use it in trusted server code only and scope queries by organization. Browser/user-scoped access goes through the Supabase client from `@gogo/auth`, which enforces RLS via the user's JWT.

## Evolving the schema

1. Edit `src/schema/*` (Drizzle definitions).
2. `npm run generate -w @gogo/db` to produce the next SQL migration (requires `DATABASE_URL`), or write the SQL by hand in `migrations/`.
3. Keep RLS policies in the same migration as the tables they protect.
