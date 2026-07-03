import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { profiles } from "./profiles";

// Append-only (no update/delete policies in RLS).
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Written only by the audit_record_version() trigger (security definer).
export const recordVersions = pgTable("record_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tableName: text("table_name").notNull(),
  recordId: uuid("record_id").notNull(),
  orgId: uuid("org_id"),
  operation: text("operation").notNull(),
  data: jsonb("data").notNull(),
  changedBy: uuid("changed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consentTerms = pgTable(
  "consent_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    body: text("body").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.slug, table.version)],
);

export const consentAcceptances = pgTable("consent_acceptances", {
  id: uuid("id").primaryKey().defaultRandom(),
  termId: uuid("term_id")
    .notNull()
    .references(() => consentTerms.id),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  recordedBy: uuid("recorded_by").references(() => profiles.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").notNull().default({}),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type AuditEvent = typeof auditEvents.$inferSelect;
export type RecordVersion = typeof recordVersions.$inferSelect;
export type ConsentTerm = typeof consentTerms.$inferSelect;
export type ConsentAcceptance = typeof consentAcceptances.$inferSelect;
