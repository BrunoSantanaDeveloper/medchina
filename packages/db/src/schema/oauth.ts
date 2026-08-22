import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { profiles } from "./profiles";

/**
 * OAuth 2.1 authorization server for the MCP connectors (migration 0088):
 * ChatGPT/Claude register dynamically, the professional authorizes her
 * workspace, and tools are called with opaque bearer tokens (hashes only —
 * the raw secret is never persisted, same discipline as capture links).
 */

export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id").notNull().unique(),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
  clientSecretHash: text("client_secret_hash"),
  clientUri: text("client_uri"),
  logoUri: text("logo_uri"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthGrants = pgTable("oauth_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
  redirectUri: text("redirect_uri").notNull(),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthTokens = pgTable("oauth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  accessTokenHash: text("access_token_hash").notNull().unique(),
  refreshTokenHash: text("refresh_token_hash").unique(),
  scope: text("scope").notNull(),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per MCP tool call: the rate-limit window + the fine-grained trail. */
export const mcpRequests = pgTable("mcp_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  tokenId: uuid("token_id").references(() => oauthTokens.id, { onDelete: "set null" }),
  tool: text("tool").notNull(),
  status: text("status").notNull().default("ok"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Weighted usage columns added to library_usage live in SQL only (0063/0088 — the ledger has no Drizzle mirror). */
export const MCP_USAGE_CHANNEL = "mcp" as const;

export type OauthClient = typeof oauthClients.$inferSelect;
export type OauthGrant = typeof oauthGrants.$inferSelect;
export type OauthToken = typeof oauthTokens.$inferSelect;
export type McpRequest = typeof mcpRequests.$inferSelect;
