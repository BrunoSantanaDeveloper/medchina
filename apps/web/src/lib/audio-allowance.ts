/**
 * The shape of `org_audio_allowance()` (migration 0024), shared by the server
 * (lib/usage.ts) and the browser (hooks/use-audio-allowance.ts).
 *
 * The allowance itself is computed in SQL and nowhere else: the app renders it,
 * the DB guard enforces it. Recomputing it here in TypeScript would create a
 * second opinion about whether someone may record — and the two would drift.
 */

export type AudioAllowance = {
  /** Where the minutes come from: a paid plan, the Pro trial, or nothing. */
  source: "plan" | "trial" | "none";
  planSlug: string | null;
  planName: string | null;
  suspended: boolean;
  minutesLimit: number;
  minutesUsed: number;
  minutesRemaining: number;
  percent: number;
  windowStart: string | null;
  windowEnd: string | null;
  trialActive: boolean;
  trialEndsAt: string | null;
  /** Never had a trial and has no paid minutes — one can still be started. */
  trialAvailable: boolean;
  /** May a NEW recording or a NEW processing run begin right now? */
  canStart: boolean;
  /** May this workspace use the Pro reasoning layer (PRD §10.8)? */
  clinicalReasoning: boolean;
};

export type AllowanceRow = {
  source: string;
  plan_slug: string | null;
  plan_name: string | null;
  suspended: boolean;
  minutes_limit: number;
  minutes_used: number;
  minutes_remaining: number;
  percent: number;
  window_start: string | null;
  window_end: string | null;
  trial_active: boolean;
  trial_ends_at: string | null;
  trial_available: boolean;
  can_start: boolean;
  clinical_reasoning: boolean;
};

export const toAllowance = (row: AllowanceRow): AudioAllowance => ({
  source: row.source === "plan" || row.source === "trial" ? row.source : "none",
  planSlug: row.plan_slug,
  planName: row.plan_name,
  suspended: row.suspended,
  minutesLimit: row.minutes_limit,
  minutesUsed: row.minutes_used,
  minutesRemaining: row.minutes_remaining,
  percent: row.percent,
  windowStart: row.window_start,
  windowEnd: row.window_end,
  trialActive: row.trial_active,
  trialEndsAt: row.trial_ends_at,
  trialAvailable: row.trial_available,
  canStart: row.can_start,
  clinicalReasoning: Boolean(row.clinical_reasoning),
});

/** Days left in the trial, floored at 0. Null when there is no trial running. */
export function trialDaysLeft(allowance: AudioAllowance): number | null {
  if (!allowance.trialEndsAt) return null;
  const ms = new Date(allowance.trialEndsAt).getTime() - Date.now();
  return Math.max(Math.ceil(ms / 86_400_000), 0);
}
