import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * One row per auth user, created automatically by the `handle_new_user`
 * trigger (see migrations/0000_init.sql). The id mirrors auth.users.id.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
