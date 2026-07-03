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
  // { language, segments: [{ speaker, start, text }] }
  result: jsonb("result"),
  metadata: jsonb("metadata").notNull().default({}),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Transcription = typeof transcriptions.$inferSelect;
