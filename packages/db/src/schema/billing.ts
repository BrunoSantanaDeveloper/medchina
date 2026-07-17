import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { profiles } from "./profiles";

export const planKind = pgEnum("plan_kind", ["recurring", "credits"]);
export const billingPeriod = pgEnum("billing_period", ["weekly", "monthly", "yearly"]);
export const moduleKind = pgEnum("module_kind", ["recurring", "one_time"]);
export const discountType = pgEnum("discount_type", ["percent", "fixed"]);
export const subscriptionStatus = pgEnum("subscription_status", [
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "canceled",
]);
export const invoiceStatus = pgEnum("invoice_status", ["open", "paid", "failed", "refunded", "void"]);
export const billingProvider = pgEnum("billing_provider", ["stripe", "asaas"]);
export const creditKind = pgEnum("credit_kind", ["purchase", "grant", "consumption", "expiry", "adjustment"]);

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  kind: planKind("kind").notNull().default("recurring"),
  period: billingPeriod("period"),
  priceCents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("BRL"),
  creditAmount: integer("credit_amount"),
  creditsExpire: boolean("credits_expire").notNull().default(false),
  trialDays: integer("trial_days").notNull().default(0),
  isFree: boolean("is_free").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  limits: jsonb("limits").notNull().default({}),
  providerRefs: jsonb("provider_refs").notNull().default({}),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  kind: moduleKind("kind").notNull().default("recurring"),
  priceCents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("BRL"),
  limits: jsonb("limits").notNull().default({}),
  providerRefs: jsonb("provider_refs").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const coupons = pgTable("coupons", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  description: text("description"),
  discountType: discountType("discount_type").notNull(),
  discountValue: integer("discount_value").notNull(),
  maxRedemptions: integer("max_redemptions"),
  redeemedCount: integer("redeemed_count").notNull().default(0),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatus("status").notNull().default("incomplete"),
    adminSuspended: boolean("admin_suspended").notNull().default(false),
    provider: billingProvider("provider"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    period: billingPeriod("period"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true }),
    billingOperationId: uuid("billing_operation_id"),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("subscriptions_org_live_unique")
      .on(table.orgId)
      .where(sql`${table.status} in ('trialing', 'active', 'past_due')`),
    uniqueIndex("subscriptions_provider_subscription_unique_idx")
      .on(table.provider, table.providerSubscriptionId)
      .where(sql`${table.provider} is not null and ${table.providerSubscriptionId} is not null`),
    uniqueIndex("subscriptions_billing_operation_unique_idx")
      .on(table.billingOperationId)
      .where(sql`${table.billingOperationId} is not null`),
  ],
);

export const subscriptionModules = pgTable("subscription_modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => subscriptions.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id")
    .notNull()
    .references(() => modules.id),
  status: text("status").notNull().default("active"),
  providerItemId: text("provider_item_id"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
});

export const creditTransactions = pgTable("credit_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  kind: creditKind("kind").notNull(),
  description: text("description"),
  sourceInvoiceKey: text("source_invoice_key").unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  provider: billingProvider("provider").notNull(),
  providerInvoiceId: text("provider_invoice_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("BRL"),
  status: invoiceStatus("status").notNull().default("open"),
  description: text("description"),
  invoiceUrl: text("invoice_url"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billingOperations = pgTable(
  "billing_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    provider: text("provider"),
    status: text("status").notNull().default("processing"),
    attempts: integer("attempts").notNull().default(1),
    claimToken: uuid("claim_token"),
    result: jsonb("result").notNull().default({}),
    errorCode: text("error_code"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("billing_operations_org_kind_idempotency_key_key").on(
      table.orgId,
      table.kind,
      table.idempotencyKey,
    ),
    check("billing_operations_kind_check", sql`${table.kind} in ('checkout', 'cancel', 'resume')`),
    check("billing_operations_provider_check", sql`${table.provider} is null or ${table.provider} in ('stripe', 'asaas')`),
    check("billing_operations_status_check", sql`${table.status} in ('processing', 'completed', 'failed')`),
    check("billing_operations_attempts_check", sql`${table.attempts} > 0`),
    check(
      "billing_operations_processing_claim_check",
      sql`${table.status} <> 'processing' or (${table.claimToken} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
  ],
);

export const billingWebhookEvents = pgTable(
  "billing_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("processing"),
    attempts: integer("attempts").notNull().default(1),
    claimToken: uuid("claim_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    errorCode: text("error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("billing_webhook_events_provider_provider_event_id_event_type_key").on(
      table.provider,
      table.providerEventId,
      table.eventType,
    ),
    check("billing_webhook_events_provider_check", sql`${table.provider} in ('stripe', 'asaas')`),
    check("billing_webhook_events_status_check", sql`${table.status} in ('processing', 'completed', 'failed')`),
    check("billing_webhook_events_attempts_check", sql`${table.attempts} > 0`),
    check(
      "billing_webhooks_processing_claim_check",
      sql`${table.status} <> 'processing' or (${table.claimToken} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionModule = typeof subscriptionModules.$inferSelect;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type BillingOperation = typeof billingOperations.$inferSelect;
export type BillingWebhookEvent = typeof billingWebhookEvents.$inferSelect;
