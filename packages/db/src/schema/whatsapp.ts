import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { profiles } from "./profiles";

export const waMessages = pgTable("wa_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: inbound messages arrive before the project resolves the org.
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  toNumber: text("to_number"),
  fromNumber: text("from_number"),
  kind: text("kind").notNull().default("text"),
  text: text("text"),
  template: text("template"),
  templateParams: jsonb("template_params"),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  // Future timestamp = scheduled send.
  sendAt: timestamp("send_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WaMessage = typeof waMessages.$inferSelect;
