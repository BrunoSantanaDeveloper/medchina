import type { SupabaseClient } from "@supabase/supabase-js";

/** Row of `connections` as the framework sees it (snake_case = DB shape). */
export interface ConnectionRecord {
  id: string;
  org_id: string;
  provider: string;
  name: string;
  status: "connected" | "error" | "disabled";
  metadata: Record<string, unknown>;
  sync_cursor: Record<string, unknown>;
  last_synced_at: string | null;
  sync_error: string | null;
}

/** Credentials as stored in `connection_secrets.secret` (service-role only). */
export type ConnectionSecret = Record<string, unknown>;

export interface TestResult {
  ok: boolean;
  /** Non-secret provider context to persist on the connection (account id...). */
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface SyncContext {
  connection: ConnectionRecord;
  secret: ConnectionSecret;
  /** Service-role client — write normalized domain data wherever the project keeps it. */
  supabase: SupabaseClient;
}

export interface SyncResult {
  /** Next incremental position; persisted on the connection when returned. */
  cursor?: Record<string, unknown>;
  /** Free-form counters for logs ("campaigns: 12"). */
  stats?: Record<string, number>;
}

/**
 * A connector = one external API integration. The template ships none;
 * derived projects implement this (e.g. a Meta Ads connector) and call
 * registerConnector() at module scope.
 */
export interface Connector {
  /** Slug stored in connections.provider (e.g. "meta-ads"). */
  provider: string;
  /** Human name shown in /settings/connections. */
  name: string;
  /** Which credential fields the generic settings form should collect. */
  secretFields: { key: string; label: string }[];
  /** Validate credentials before saving; return provider metadata. */
  test(secret: ConnectionSecret): Promise<TestResult>;
  /** One sync cycle. Fetch since ctx.connection.sync_cursor, persist, return next cursor. */
  sync(ctx: SyncContext): Promise<SyncResult>;
}
