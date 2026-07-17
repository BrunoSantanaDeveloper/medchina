import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

/**
 * One short-lived QR collection window. The bearer token is never stored;
 * tokenHash is its SHA-256 digest and these rows are exposed only through RPCs.
 */
export const patientConsentSessions = pgTable(
  "patient_consent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull(),
    consultationId: uuid("consultation_id"),
    tokenHash: text("token_hash").notNull(),
    clientRequestId: uuid("client_request_id").notNull(),
    status: text("status").notNull().default("pending"),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: text("close_reason"),
    completionIdempotencyKey: uuid("completion_idempotency_key"),
    signerRole: text("signer_role"),
    signerName: text("signer_name"),
    representativeRelationship: text("representative_relationship"),
    identityDeclaredAt: timestamp("identity_declared_at", { withTimezone: true }),
    affirmationVersion: integer("affirmation_version").notNull().default(1),
    presentedLocale: text("presented_locale").notNull().default("pt-BR"),
  },
  (table) => [
    unique("patient_consent_sessions_token_hash_key").on(table.tokenHash),
    unique("patient_consent_sessions_org_id_client_request_id_key").on(table.orgId, table.clientRequestId),
    uniqueIndex("patient_consent_sessions_one_pending_patient_idx")
      .on(table.patientId)
      .where(sql`${table.status} = 'pending'`),
    index("patient_consent_sessions_org_created_idx").on(table.orgId, table.createdAt),
    index("patient_consent_sessions_pending_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'pending'`),
    check("patient_consent_sessions_token_hash_format_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "patient_consent_sessions_status_check",
      sql`${table.status} in ('pending', 'completed', 'cancelled', 'expired', 'invalidated')`,
    ),
    check("patient_consent_sessions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check("patient_consent_sessions_affirmation_version_check", sql`${table.affirmationVersion} > 0`),
    check(
      "patient_consent_sessions_presented_locale_check",
      sql`${table.presentedLocale} in ('pt-BR', 'en', 'es', 'fr', 'de')`,
    ),
  ],
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
  consentSessionId: uuid("consent_session_id").references(() => patientConsentSessions.id),
  manifestedBy: text("manifested_by").notNull().default("professional"),
});

/** Version-pinned terms and three atomic decisions collected in one QR step. */
export const patientConsentSessionItems = pgTable(
  "patient_consent_session_items",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => patientConsentSessions.id, { onDelete: "cascade" }),
    termId: uuid("term_id")
      .notNull()
      .references(() => consentTerms.id),
    slug: text("slug").notNull(),
    termTitle: text("term_title").notNull(),
    termBody: text("term_body").notNull(),
    termVersion: integer("term_version").notNull(),
    decision: boolean("decision"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    acceptanceId: uuid("acceptance_id").references(() => consentAcceptances.id),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.slug] }),
    unique("patient_consent_session_items_session_id_term_id_key").on(table.sessionId, table.termId),
    check(
      "patient_consent_session_items_slug_check",
      sql`${table.slug} in ('audio-recording', 'ai-processing', 'clinical-images')`,
    ),
    check("patient_consent_session_items_version_check", sql`${table.termVersion} > 0`),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type RecordVersion = typeof recordVersions.$inferSelect;
export type ConsentTerm = typeof consentTerms.$inferSelect;
export type ConsentAcceptance = typeof consentAcceptances.$inferSelect;
export type PatientConsentSession = typeof patientConsentSessions.$inferSelect;
export type PatientConsentSessionItem = typeof patientConsentSessionItems.$inferSelect;
