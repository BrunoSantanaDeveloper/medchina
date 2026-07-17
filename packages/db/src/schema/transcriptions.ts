import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { profiles } from "./profiles";

export const transcriptions = pgTable("transcriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Nulled after retention delete (delete_audio_after).
  audioPath: text("audio_path"),
  mime: text("mime").notNull(),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  deleteAudioAfter: boolean("delete_audio_after").notNull().default(false),
  retentionPolicy: text("retention_policy").notNull().default("after_validation"),
  retainUntil: timestamp("retain_until", { withTimezone: true }),
  // { language, segments: [{ speaker, start, text }] }
  result: jsonb("result"),
  metadata: jsonb("metadata").notNull().default({}),
  // Retention is a professional decision: source audio may only be removed
  // after this validation boundary has been crossed.
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  validatedBy: uuid("validated_by").references(() => profiles.id, { onDelete: "set null" }),
  audioDeletedAt: timestamp("audio_deleted_at", { withTimezone: true }),
  deletionError: text("deletion_error"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Transcription = typeof transcriptions.$inferSelect;
