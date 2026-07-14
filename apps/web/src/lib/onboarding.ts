import { DEFAULTS } from "@/config";
import { computeProgress, type FlowKey, getOnboardingState, type OnboardingStep } from "@flyee/onboarding";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MedChina activation (PRD §7.1/§7.3). The free-plan aha moment is the FIRST
 * FINALIZED MANUAL CONSULTATION — that is what "activated" means here, so the
 * required steps stop there. Everything after it (AI demo, mobile app, first
 * AI consultation) belongs to the trial journey and is nudged elsewhere.
 *
 * Steps use LIVE predicates over real clinical state (has a patient? has a
 * finalized consultation?), never click-tracking — the checklist must reflect
 * reality even if the user did the work from another screen.
 */
export const ONBOARDING_FLOW = "activation";

/** Route hosting the post-signup start choice (PRD §6.4). */
export const ONBOARDING_ROUTE = "/onboarding";

/**
 * Personal flow: one professional per workspace in the MVP, so activation is
 * the user's, not the org's.
 */
export const ONBOARDING_ORG_SCOPED = false;

export interface ActivationFacts {
  hasProfileName: boolean;
  hasPatient: boolean;
  hasFinalizedConsultation: boolean;
}

/** Reads the real product state the checklist is derived from. */
export async function getActivationFacts(supabase: SupabaseClient, userId: string): Promise<ActivationFacts> {
  const [profile, patients, finalized] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    supabase.from("patients").select("id", { count: "exact", head: true }),
    supabase.from("consultations").select("id", { count: "exact", head: true }).eq("status", "finalized"),
  ]);
  return {
    hasProfileName: Boolean(profile.data?.display_name?.trim()),
    hasPatient: (patients.count ?? 0) > 0,
    hasFinalizedConsultation: (finalized.count ?? 0) > 0,
  };
}

/**
 * The steps rendered by the checklist. `facts` come from getActivationFacts;
 * with no facts (server-less contexts) the steps still render as pending.
 */
export function buildOnboardingSteps(facts?: ActivationFacts): OnboardingStep[] {
  return [
    {
      key: "profile",
      title: "onboarding-step-profile",
      description: "onboarding-step-profile-description",
      href: "/settings",
      done: facts?.hasProfileName,
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
 * A brand-new account (no start choice made yet, nothing done) gets the start
 * screen; everyone else lands on the app home, where the checklist keeps the
 * remaining steps visible.
 */
export async function resolvePostAuthDestination(supabase: SupabaseClient, userId: string): Promise<string> {
  if (!isOnboardingEnabled) return DEFAULTS.appRoot;
  try {
    const key = await getOnboardingFlowKey(supabase, userId);
    const state = await getOnboardingState(supabase, key);
    // "welcome" is stamped when the user picks a starting path (PRD §6.4);
    // once chosen (or once activated) the home takes over the nudging.
    if (state.completedAt || state.completedSteps.includes("welcome")) return DEFAULTS.appRoot;

    const facts = await getActivationFacts(supabase, userId);
    const progress = computeProgress(buildOnboardingSteps(facts), state);
    return progress.complete ? DEFAULTS.appRoot : ONBOARDING_ROUTE;
  } catch {
    return DEFAULTS.appRoot;
  }
}
