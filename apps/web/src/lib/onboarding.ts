import { DEFAULTS } from "@/config";
import {
  completeStep,
  computeProgress,
  type FlowKey,
  getOnboardingState,
  type OnboardingStateRow,
  type OnboardingStep,
} from "@flyee/onboarding";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MedChina's path from sign-up to the first finalized record — ONE description
 * of it, read by every surface that shows progress: the preparation flow
 * (`/onboarding`), the home checklist, and the hub (`/primeiros-passos`).
 *
 * It has two halves, and they are different kinds of thing:
 *
 *  - **Preparation** — what the professional can do alone at her desk, minutes
 *    after signing up: say how she works, how she signs, get the recording
 *    ready, book the next appointment. This is the onboarding.
 *  - **The first consultation** — which needs a patient in the room. It is NOT
 *    part of the onboarding any more. A user test showed the professional lost
 *    when the guide asked her to open a consultation with nobody there: a
 *    consultation is a moment of USE, and the guidance for it now lives on the
 *    consultation screen, the first time she opens one.
 *
 * Activation (PRD §7.1) is unchanged: the first FINALIZED consultation. The
 * preparation does not produce it — it removes what would get in its way.
 *
 * Steps use LIVE predicates over real state wherever the data can tell, never
 * click-tracking. A stored flag is used only for a step that leaves nothing
 * behind to observe (she looked at the recording step and moved on).
 */
export const ONBOARDING_FLOW = "activation";

/** Route hosting the preparation flow. */
export const ONBOARDING_ROUTE = "/onboarding";

/**
 * Personal flow: one professional per workspace in the MVP, so activation is
 * the user's, not the org's.
 */
export const ONBOARDING_ORG_SCOPED = false;

/**
 * Stamped the first time she answers the preparation OR says "later". It is
 * what stops the auth entry points from sending her back to `/onboarding` on
 * every sign-in — skipping used to record nothing, so someone who skipped on
 * day one met the same opening screen at every login until she finalized a
 * consultation. The key predates this flow (it was the start-choice sentinel)
 * and is kept so accounts that chose a track before keep their answer.
 */
export const PREP_STARTED_STEP = "welcome";

/** The four preparation steps, in order. Also the `prep_step` telemetry values (migration 0120). */
export const PREP_STEP_KEYS = ["scope", "signature", "recording", "next"] as const;
export type PrepStepKey = (typeof PREP_STEP_KEYS)[number];

/** Stored flags for the steps (or outcomes) that leave nothing in the data to observe. */
const PREP_STORED_STEP: Record<PrepStepKey, string> = {
  scope: "prep-scope",
  signature: "prep-signature",
  recording: "prep-recording",
  next: "prep-next",
};

/** She dismissed the first-consultation guide on the consultation screen. */
export const FIRST_CONSULTATION_GUIDE_STEP = "first-consultation-guide";

export const isPrepStepKey = (value: string | null | undefined): value is PrepStepKey =>
  PREP_STEP_KEYS.includes(value as PrepStepKey);

export interface ActivationFacts {
  hasProfileName: boolean;
  /** She said how she works and the practice timezone is confirmed (step 1 of the preparation). */
  hasPracticeContext: boolean;
  hasPatient: boolean;
  hasFinalizedConsultation: boolean;
}

export interface ExperienceFacts extends ActivationFacts {
  /** A title or a registration prints under her signature. */
  hasProfessionalIdentity: boolean;
  /** Anything on the agenda or in the chart: scheduled, open or closed. */
  hasConsultation: boolean;
  hasAiReadyConsent: boolean;
  hasRecording: boolean;
  hasReadyRecording: boolean;
}

/**
 * A read that failed is not a "no". Every fact here is a `count > 0` or a
 * `Boolean(row)`, so an errored query quietly becomes `false` — and a checklist
 * built from that tells someone with a full practice that she has done nothing.
 * The readers throw instead, and each caller decides what an unknown state
 * looks like: the flow and the hub show an error with a retry, the home card
 * stays hidden, the post-auth resolver falls back to the app.
 */
function assertRead(results: { error: { message: string } | null }[]): void {
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`onboarding facts unavailable: ${failed.error.message}`);
}

/** One read of the account-level rows; both fact sets below are cut from it. */
async function readActivation(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActivationFacts & { hasProfessionalIdentity: boolean }> {
  const [profile, membership, patients, finalized] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, professional_title, professional_registration")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("memberships")
      .select("organizations(timezone_confirmed_at)")
      .eq("user_id", userId)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    supabase.from("patients").select("id", { count: "exact", head: true }),
    supabase.from("consultations").select("id", { count: "exact", head: true }).eq("status", "finalized"),
  ]);
  assertRead([profile, membership, patients, finalized]);
  const organization = membership.data?.organizations as unknown as { timezone_confirmed_at?: string | null } | null;
  const facts = {
    hasProfileName: Boolean(profile.data?.display_name?.trim()),
    hasPracticeContext: Boolean(organization?.timezone_confirmed_at),
    hasPatient: (patients.count ?? 0) > 0,
    hasFinalizedConsultation: (finalized.count ?? 0) > 0,
    hasProfessionalIdentity: Boolean(
      profile.data?.professional_title?.trim() || profile.data?.professional_registration?.trim(),
    ),
  };
  if (facts.hasProfileName && facts.hasPatient && facts.hasFinalizedConsultation) {
    // Database-side coalesce makes the activation moment sticky.
    await supabase.rpc("sync_medchina_activation");
  }
  return facts;
}

/** Reads the real product state the home checklist is derived from. */
export async function getActivationFacts(supabase: SupabaseClient, userId: string): Promise<ActivationFacts> {
  const { hasProfileName, hasPracticeContext, hasPatient, hasFinalizedConsultation } = await readActivation(
    supabase,
    userId,
  );
  return { hasProfileName, hasPracticeContext, hasPatient, hasFinalizedConsultation };
}

/** Every fact the preparation flow and the hub show. No click masquerades as clinical progress. */
export async function getExperienceFacts(supabase: SupabaseClient, userId: string): Promise<ExperienceFacts> {
  const [activation, consultations, audioConsents, aiConsents, recordings, readyRecordings] = await Promise.all([
    readActivation(supabase, userId),
    supabase.from("consultations").select("id", { count: "exact", head: true }),
    supabase
      .from("consent_acceptances")
      .select("subject_id, consent_terms!inner(slug)")
      .is("revoked_at", null)
      .eq("consent_terms.slug", "audio-recording"),
    supabase
      .from("consent_acceptances")
      .select("subject_id, consent_terms!inner(slug)")
      .is("revoked_at", null)
      .eq("consent_terms.slug", "ai-processing"),
    supabase.from("recordings").select("id", { count: "exact", head: true }),
    supabase.from("recordings").select("id", { count: "exact", head: true }).eq("status", "ready"),
  ]);
  assertRead([consultations, audioConsents, aiConsents, recordings, readyRecordings]);

  const audioSubjects = new Set((audioConsents.data ?? []).map((row) => String(row.subject_id)));
  const hasAiReadyConsent = (aiConsents.data ?? []).some((row) => audioSubjects.has(String(row.subject_id)));

  return {
    ...activation,
    hasConsultation: (consultations.count ?? 0) > 0,
    hasAiReadyConsent,
    hasRecording: (recordings.count ?? 0) > 0,
    hasReadyRecording: (readyRecordings.count ?? 0) > 0,
  };
}

// ---------- The preparation ----------

export type PrepStepsDone = Record<PrepStepKey, boolean>;

/**
 * Which preparation steps are behind her. The data answers first; the stored
 * flag only covers what the data cannot see — she read the step and chose to
 * move on ("agora não" is a decision, and asking again at every visit is how a
 * short setup starts to feel like a form).
 */
export function prepStepsDone(
  facts: ExperienceFacts,
  state: Pick<OnboardingStateRow, "completedSteps">,
): PrepStepsDone {
  const stored = (key: PrepStepKey) => state.completedSteps.includes(PREP_STORED_STEP[key]);
  return {
    scope: facts.hasPracticeContext,
    signature: facts.hasProfessionalIdentity || stored("signature"),
    recording: facts.hasRecording || stored("recording"),
    next: facts.hasConsultation || stored("next"),
  };
}

/** The first step still open, or null when the whole preparation is behind her. */
export function firstPendingPrepStep(done: PrepStepsDone): PrepStepKey | null {
  return PREP_STEP_KEYS.find((key) => !done[key]) ?? null;
}

/** Remembers that she passed a step that leaves no trace in the data. Idempotent. */
export async function markPrepStep(supabase: SupabaseClient, key: FlowKey, step: PrepStepKey) {
  return completeStep(supabase, key, PREP_STORED_STEP[step]);
}

/** She answered the preparation or said "later": stop sending her back at sign-in. */
export async function markPreparationStarted(supabase: SupabaseClient, key: FlowKey) {
  return completeStep(supabase, key, PREP_STARTED_STEP);
}

/** The preparation as the hub lists it. Titles and descriptions are i18n keys (`product`). */
export function buildPreparationSteps(done?: PrepStepsDone): OnboardingStep[] {
  return PREP_STEP_KEYS.map((key) => ({
    key,
    title: `prep-${key}-title`,
    description: `prep-${key}-summary`,
    href: `${ONBOARDING_ROUTE}?passo=${key}`,
    done: done?.[key],
    // Only the first step changes what the product does; the rest are hers to skip.
    required: key === "scope",
  }));
}

// ---------- The home checklist ----------

/**
 * The three steps to the first finalized record, as the home shows them.
 * `facts` come from getActivationFacts; with no facts (server-less contexts)
 * the steps still render as pending.
 *
 * The first key is still `practice-context`: it is the same predicate it always
 * was (the practice's context is confirmed), now reached through the
 * preparation instead of a timezone form.
 */
export function buildOnboardingSteps(facts?: ActivationFacts): OnboardingStep[] {
  return [
    {
      key: "practice-context",
      title: "onboarding-step-prepare",
      description: "onboarding-step-prepare-description",
      href: ONBOARDING_ROUTE,
      done: facts?.hasPracticeContext,
    },
    {
      key: "first-patient",
      title: "onboarding-step-patient",
      description: "onboarding-step-patient-description",
      href: "/pacientes/novo",
      done: facts?.hasPatient,
    },
    {
      key: "first-consultation",
      title: "onboarding-step-consultation",
      description: "onboarding-step-consultation-description",
      href: "/pacientes",
      done: facts?.hasFinalizedConsultation,
    },
  ];
}

/** Step definitions without live state — used where only the shape matters. */
export const ONBOARDING_STEPS: OnboardingStep[] = buildOnboardingSteps();

export const isOnboardingEnabled = ONBOARDING_STEPS.length > 0;

// ---------- The first consultation, as the hub lists it ----------

/**
 * What stands between a prepared practice and the first finalized record.
 * `withRecording` adds the three things a recorded consultation needs; a
 * professional who types her records never sees them.
 */
export function buildFirstConsultationSteps(
  facts: ExperienceFacts | undefined,
  withRecording: boolean,
): OnboardingStep[] {
  const steps: OnboardingStep[] = [
    {
      key: "first-patient",
      title: "getting-first-patient",
      description: "getting-first-patient-body",
      href: "/pacientes/novo",
      done: facts?.hasPatient,
    },
  ];
  if (withRecording) {
    steps.push(
      {
        key: "consent",
        title: "getting-first-consent",
        description: "getting-first-consent-body",
        href: "/pacientes",
        done: facts?.hasAiReadyConsent,
      },
      {
        key: "record",
        title: "getting-first-record",
        description: "getting-first-record-body",
        href: "/pacientes",
        done: facts?.hasRecording,
      },
      {
        key: "review",
        title: "getting-first-review",
        description: "getting-first-review-body",
        href: "/pacientes",
        done: facts?.hasReadyRecording,
      },
    );
  }
  steps.push({
    key: "first-consultation",
    title: "getting-first-finalize",
    description: "getting-first-finalize-body",
    href: "/pacientes",
    done: facts?.hasFinalizedConsultation,
  });
  return steps;
}

/**
 * Does this professional's path include recording? She said so in the
 * preparation (`selectedTrack`), or the data already shows it.
 */
export function followsRecordingPath(
  state: Pick<OnboardingStateRow, "selectedTrack">,
  facts: Pick<ExperienceFacts, "hasRecording" | "hasAiReadyConsent"> | undefined,
): boolean {
  return state.selectedTrack === "ai" || Boolean(facts?.hasRecording) || Boolean(facts?.hasAiReadyConsent);
}

// ---------- Plumbing ----------

/** The user's active organization (first membership) — for org-scoped flows. */
async function getActiveOrgId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

/**
 * The flow key shared by the resolver, the checklist card and the /onboarding
 * page, so they all read/write the SAME onboarding_state row (adds org_id when
 * the flow is org-scoped). Use this instead of hand-building the key.
 */
export async function getOnboardingFlowKey(supabase: SupabaseClient, userId: string): Promise<FlowKey> {
  const orgId = ONBOARDING_ORG_SCOPED ? await getActiveOrgId(supabase, userId) : null;
  return { userId, orgId, flow: ONBOARDING_FLOW };
}

/**
 * Where a user goes right after signing up / signing in. Called from the auth
 * entry points (never the middleware, which runs on every request and must
 * stay query-free). Falls back to the app root on any failure: auth must never
 * dead-end.
 *
 * A brand-new account (nothing answered, nothing skipped, nothing done) gets
 * the preparation; everyone else lands on the app home, where the checklist
 * keeps the remaining steps visible and one link away.
 */
export async function resolvePostAuthDestination(supabase: SupabaseClient, userId: string): Promise<string> {
  if (!isOnboardingEnabled) return DEFAULTS.appRoot;
  try {
    const key = await getOnboardingFlowKey(supabase, userId);
    const state = await getOnboardingState(supabase, key);
    if (state.completedAt || state.selectedTrack || state.completedSteps.includes(PREP_STARTED_STEP)) {
      return DEFAULTS.appRoot;
    }

    const facts = await getActivationFacts(supabase, userId);
    const progress = computeProgress(buildOnboardingSteps(facts), state);
    // Someone who already said how she works has nothing left to be sent to —
    // she did it from Settings or from an earlier version of this flow.
    if (progress.complete || facts.hasPracticeContext) return DEFAULTS.appRoot;
    return ONBOARDING_ROUTE;
  } catch {
    return DEFAULTS.appRoot;
  }
}
