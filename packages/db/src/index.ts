import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export * from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Server-side Drizzle client for Supabase Postgres.
 *
 * IMPORTANT: this connects with the DATABASE_URL role and BYPASSES RLS when
 * that role is the service role/postgres. Use it only in trusted server code
 * (route handlers, server actions, jobs) and always scope queries by the
 * caller's organization. For RLS-enforced access from the browser or with
 * the user's JWT, use the Supabase client from @gogo/auth instead.
 *
 * On Vercel/serverless, point DATABASE_URL at the Supabase pooler
 * (port 6543) and keep `prepare: false`.
 */
export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema });
}
