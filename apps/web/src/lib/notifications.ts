import "server-only";

import { createServiceClient } from "@flyee/auth/service";

export type NotificationInput = {
  /** Icon family in the bell: system | team | billing | <project-defined>. */
  type?: string;
  title: string;
  body?: string;
  /** Destination opened on click (internal path or full URL). */
  href?: string;
  /**
   * Idempotency key for notifications a scheduled job may produce twice (a
   * daily digest, a retry). `notifications.source_key` is unique across the
   * table, so the user id is appended here — the caller's key names the
   * EVENT ("admin-watch:2026-09-18"), not the row. A second attempt inserts
   * nothing and is reported as `created: 0`, which is also how a caller knows
   * not to send the matching e-mail again.
   */
  sourceKey?: string;
};

export type NotifyResult = {
  sent: boolean;
  created?: number;
  /** Who actually received a new row — the ones a matching e-mail should go to. */
  createdFor?: string[];
  error?: string;
};

/**
 * Creates in-app notifications (header bell) for a set of users. Server-only:
 * inserts go through the service role because RLS blocks users from writing
 * each other's notifications. Returns { sent: false } without throwing when
 * Supabase is not configured — notifications are always best-effort.
 *
 * Database-side events (e.g. "member joined") use triggers instead; see
 * migration 0012_notifications.sql.
 */
export async function notifyUsers(userIds: string[], input: NotificationInput): Promise<NotifyResult> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { sent: false };
  }
  if (userIds.length === 0) return { sent: true };

  const service = createServiceClient();
  const row = (userId: string) => ({
    user_id: userId,
    type: input.type ?? "system",
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
  });

  // With a key, one row at a time: a bulk insert is atomic, so one user who
  // already has today's digest would block everybody else's.
  if (input.sourceKey) {
    const createdFor: string[] = [];
    for (const userId of userIds) {
      const { error } = await service
        .from("notifications")
        .insert({ ...row(userId), source_key: `${input.sourceKey}:${userId}` });
      // 23505: this exact notification already exists — the point of the key.
      if (error && error.code !== "23505") {
        return { sent: false, created: createdFor.length, createdFor, error: error.message };
      }
      if (!error) createdFor.push(userId);
    }
    return { sent: true, created: createdFor.length, createdFor };
  }

  const { error } = await service.from("notifications").insert(userIds.map(row));
  if (error) return { sent: false, created: 0, createdFor: [], error: error.message };
  return { sent: true, created: userIds.length, createdFor: userIds };
}

export const notifyUser = (userId: string, input: NotificationInput) => notifyUsers([userId], input);
