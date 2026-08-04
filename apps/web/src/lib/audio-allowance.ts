/**
 * The shape of `org_audio_allowance()` (migration 0024), shared by the server
 * (lib/usage.ts) and the browser (hooks/use-audio-allowance.ts).
 *
 * The allowance itself is computed in SQL and nowhere else: the app renders it,
 * the DB guard enforces it. Recomputing it here in TypeScript would create a
 * second opinion about whether someone may record — and the two would drift.
 */

/**
 * WHY the workspace may or may not start AI work (migration 0054).
 *
 * The flags below describe the state; this names the cause. Screens must
 * branch on it instead of inferring intent from `canStart`/`trialAvailable`,
 * because the actions that resolve each cause are different and not
 * interchangeable: a failed card is not fixed by buying anything, and a
 * suspension is not fixed by the professional at all.
 */
export type AllowanceReason =
  | "ok"
  | "past_due_grace"
  | "past_due_blocked"
  | "suspended"
  | "pack_only"
  | "trial_not_started"
  | "trial_over"
  | "cycle_exhausted"
  | "no_plan";

const REASONS: readonly AllowanceReason[] = [
  "ok",
  "past_due_grace",
  "past_due_blocked",
  "suspended",
  "pack_only",
  "trial_not_started",
  "trial_over",
  "cycle_exhausted",
  "no_plan",
];

export type AudioAllowance = {
  /** Where the minutes come from: a paid plan, the Pro trial, or nothing. */
  source: "plan" | "trial" | "none";
  planSlug: string | null;
  planName: string | null;
  suspended: boolean;
  /** The CYCLE's limit/consumption — what the 80/95/100% alerts are about. */
  minutesLimit: number;
  minutesUsed: number;
  cycleMinutesRemaining: number;
  /** Minutes bought à la carte, spent only after the cycle (migration 0055). */
  packMinutesRemaining: number;
  /** What she can still record: cycle + pack. */
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
  /** Named cause of the state above — never inferred from the flags. */
  reason: AllowanceReason;
  /** The trial's own window closed by TIME; its unused minutes are gone. */
  cycleExpired: boolean;
  /** The provider reported a failed renewal for the live subscription. */
  pastDue: boolean;
  /**
   * There is an unpaid charge on a PAID plan — independent of whether she can
   * still record.
   *
   * Deliberately separate from `reason`: a past_due workspace with purchased
   * minutes still records, so `reason` reads 'pack_only' and the recovery
   * surface disappeared for exactly the person holding an unpaid invoice.
   */
  dunning: boolean;
  /** While inside the dunning window: when it closes. Null once it has. */
  graceEndsAt: string | null;
  /** May this workspace buy a minute pack right now? (Paid plans only.) */
  packPurchasable: boolean;
};

export type AllowanceRow = {
  source: string;
  plan_slug: string | null;
  plan_name: string | null;
  suspended: boolean;
  minutes_limit: number;
  minutes_used: number;
  cycle_minutes_remaining: number | null;
  pack_minutes_remaining: number | null;
  minutes_remaining: number;
  percent: number;
  window_start: string | null;
  window_end: string | null;
  trial_active: boolean;
  trial_ends_at: string | null;
  trial_available: boolean;
  can_start: boolean;
  clinical_reasoning: boolean;
  reason: string | null;
  cycle_expired?: boolean | null;
  past_due: boolean | null;
  dunning?: boolean | null;
  grace_ends_at: string | null;
  pack_purchasable: boolean | null;
};

export const toAllowance = (row: AllowanceRow): AudioAllowance => ({
  source: row.source === "plan" || row.source === "trial" ? row.source : "none",
  planSlug: row.plan_slug,
  planName: row.plan_name,
  suspended: row.suspended,
  minutesLimit: row.minutes_limit,
  minutesUsed: row.minutes_used,
  // A database predating migration 0055 reports neither split; falling back to
  // the whole balance as cycle minutes is what that database actually meant.
  cycleMinutesRemaining: row.cycle_minutes_remaining ?? row.minutes_remaining,
  packMinutesRemaining: row.pack_minutes_remaining ?? 0,
  minutesRemaining: row.minutes_remaining,
  percent: row.percent,
  windowStart: row.window_start,
  windowEnd: row.window_end,
  trialActive: row.trial_active,
  trialEndsAt: row.trial_ends_at,
  trialAvailable: row.trial_available,
  canStart: row.can_start,
  clinicalReasoning: Boolean(row.clinical_reasoning),
  // An unrecognized reason must not silently read as "everything is fine": a
  // database older than this client can only be trusted about `can_start`.
  reason: REASONS.includes(row.reason as AllowanceReason)
    ? (row.reason as AllowanceReason)
    : row.can_start
      ? "ok"
      : "no_plan",
  cycleExpired: Boolean(row.cycle_expired),
  pastDue: Boolean(row.past_due),
  // A database predating migration 0067 does not report it; falling back to
  // `past_due` is what that database actually meant.
  dunning: row.dunning === undefined || row.dunning === null ? Boolean(row.past_due) : Boolean(row.dunning),
  graceEndsAt: row.grace_ends_at,
  packPurchasable: Boolean(row.pack_purchasable),
});

/** Days left in the dunning window, floored at 0. Null when not past due. */
export function graceDaysLeft(allowance: AudioAllowance): number | null {
  if (!allowance.graceEndsAt) return null;
  const ms = new Date(allowance.graceEndsAt).getTime() - Date.now();
  return Math.max(Math.ceil(ms / 86_400_000), 0);
}

/** Days left in the trial, floored at 0. Null when there is no trial running. */
export function trialDaysLeft(allowance: AudioAllowance): number | null {
  if (!allowance.trialEndsAt) return null;
  const ms = new Date(allowance.trialEndsAt).getTime() - Date.now();
  return Math.max(Math.ceil(ms / 86_400_000), 0);
}
