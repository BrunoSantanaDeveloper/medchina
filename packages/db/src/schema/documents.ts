import { integer, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { profiles } from "./profiles";

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Project-defined template slug (e.g. "session-plan", "invoice").
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  payload: jsonb("payload").notNull().default({}),
  version: integer("version").notNull().default(1),
  parentId: uuid("parent_id").references((): AnyPgColumn => documents.id),
  status: text("status").notNull().default("draft"),
  verifyCode: text("verify_code").notNull().unique(),
  contentHash: text("content_hash"),
  storagePath: text("storage_path"),
  issuedBy: uuid("issued_by").references(() => profiles.id, { onDelete: "set null" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DocumentRow = typeof documents.$inferSelect;
