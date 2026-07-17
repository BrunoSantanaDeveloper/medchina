import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./profiles";

/**
 * In-app notifications behind the header bell (migration 0012). Created
 * by server code or triggers; read/marked by their owner via RLS.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("system"),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    sourceKey: text("source_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_source_key_unique_idx")
      .on(table.sourceKey)
      .where(sql`${table.sourceKey} is not null`),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
