import { bigint, integer, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  // Stable source identity makes retries idempotent and versions atomic.
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  subjectType: text("subject_type"),
  subjectId: text("subject_id"),
  idempotencyKey: uuid("idempotency_key"),
  sourceRevision: bigint("source_revision", { mode: "number" }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  sourceValidatedAt: timestamp("source_validated_at", { withTimezone: true }),
  sourceSnapshot: jsonb("source_snapshot"),
  patientId: uuid("patient_id"),
  consultationId: uuid("consultation_id"),
  planId: uuid("plan_id"),
  issueClaimToken: uuid("issue_claim_token"),
  issueLeaseExpiresAt: timestamp("issue_lease_expires_at", { withTimezone: true }),
  issueAttempts: integer("issue_attempts").notNull().default(0),
  issuedBy: uuid("issued_by").references(() => profiles.id, { onDelete: "set null" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DocumentRow = typeof documents.$inferSelect;
