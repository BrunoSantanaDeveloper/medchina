"use client";

/** Mirrors the allowlist in migration 0084. */
export type ProTrialOrigin = "recorder" | "agenda" | "import" | "library" | "patient" | "other";

/**
 * Once per page session per workspace. The server RPC is already idempotent, so
 * this is not a correctness guard — it stops an ordinary screen from POSTing on
 * every single save for a workspace that is on a paid plan and can never start
 * a trial anyway.
 */
const attempted = new Set<string>();

/**
 * Starts the Pro trial at the first operational action, if this workspace is
 * still eligible (migration 0084 broadened PRD §5.7, which fired only at the
 * first AI consultation — the highest-commitment action in the product).
 *
 * Two properties every caller depends on:
 *
 *  - **It never blocks or breaks the action that triggered it.** Booking an
 *    appointment must not wait on a billing RPC, and must still succeed if this
 *    fails. Callers fire it after their own success, and ignore rejections.
 *  - **It reports whether it actually started one.** A trial that begins in
 *    silence puts her on a 14-day clock she never saw, which is how a trial
 *    expires "without being used". Callers with somewhere to say it should tell
 *    her; `started` is false for a no-op, so the message appears exactly once.
 */
export async function ensureProTrial(orgId: string | null, origin: ProTrialOrigin): Promise<{ started: boolean }> {
  if (!orgId || attempted.has(orgId)) return { started: false };
  attempted.add(orgId);
  try {
    const response = await fetch("/api/billing/start-trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, origin }),
    });
    if (!response.ok) return { started: false };
    const json = (await response.json().catch(() => null)) as { started?: boolean } | null;
    return { started: json?.started === true };
  } catch {
    // An operational action already succeeded; a failed promotion is not its
    // problem, and the next action will try again in a later session.
    attempted.delete(orgId);
    return { started: false };
  }
}
