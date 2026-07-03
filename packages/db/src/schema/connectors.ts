import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { profiles } from "./profiles";

export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Connector slug registered in @gogo/connectors (e.g. "meta-ads").
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("connected"),
  metadata: jsonb("metadata").notNull().default({}),
  syncCursor: jsonb("sync_cursor").notNull().default({}),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  syncError: text("sync_error"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Service-role only (RLS enabled with no policies).
export const connectionSecrets = pgTable("connection_secrets", {
  connectionId: uuid("connection_id")
    .primaryKey()
    .references(() => connections.id, { onDelete: "cascade" }),
  secret: jsonb("secret").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Connection = typeof connections.$inferSelect;
