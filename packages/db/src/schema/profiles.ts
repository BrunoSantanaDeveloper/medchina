import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * One row per auth user, created automatically by the `handle_new_user`
 * trigger (see migrations/0000_init.sql). The id mirrors auth.users.id.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  practiceModalities: text("practice_modalities").array().notNull().default([]),
  /**
   * What she practises beyond the five product modalities (0119), as she typed
   * it. No clinical effect: it never widens the therapeutic plan and is never
   * sent to a model.
   */
  practiceModalitiesOther: text("practice_modalities_other").array().notNull().default([]),
  /** Areas she follows (0103). Only "fertility" today — it enables the cycle/fertility anamnesis block. */
  practiceAreas: text("practice_areas").array().notNull().default([]),
  /**
   * Her own appointment-reminder message (0123), carrying {name}/{date}/{time}
   * tokens. Null means "use the localized product default" — clearing the field
   * restores the original copy, it never sends an empty reminder.
   */
  whatsappReminderTemplate: text("whatsapp_reminder_template"),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
