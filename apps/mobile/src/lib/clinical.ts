import type { ConsultationStatus } from "@flyee/clinical";

import {
  cacheOrgId,
  cacheTodayConsultations,
  readCachedConsultation,
  readCachedOrgId,
  readCachedTodayConsultations,
} from "@/lib/clinical-cache";
import { supabase } from "@/lib/supabase";

/**
 * The clinical data the capture app needs (PRD §11). The app's scope is
 * CAPTURE, not review: it reads the day's consultations, verifies consent and
 * writes recordings. Everything it touches is guarded by the same RLS and the
 * same database triggers the web uses — the app is not a second source of truth.
 *
 * Every read distinguishes "there is nothing" from "I could not reach the
 * server". A failed read is never returned as an empty day: it falls back to
 * the encrypted local cache and says so.
 */

export type TodayConsultation = {
  id: string;
  status: ConsultationStatus;
  startedAt: string;
  durationMinutes: number;
  reason: string | null;
  patientId: string;
  patientName: string;
  /** Clinical alerts to surface BEFORE the consultation (allergies, pregnancy…). */
  alerts: { label: string }[];
};

const CONSULTATION_FIELDS =
  "id, status, scheduled_for, started_at, duration_minutes, appointment_note, chief_complaint, patient_id, patients(full_name, alerts)";

function toConsultation(row: Record<string, unknown>): TodayConsultation {
  const patient = row.patients as unknown as { full_name: string; alerts: { label: string }[] | null } | null;
  return {
    id: row.id as string,
    status: row.status as ConsultationStatus,
    startedAt: (row.scheduled_for ?? row.started_at) as string,
    durationMinutes: row.duration_minutes as number,
    reason: (row.appointment_note ?? row.chief_complaint) as string | null,
    patientId: row.patient_id as string,
    patientName: patient?.full_name ?? "—",
    alerts: patient?.alerts ?? [],
  };
}

/** The professional's workspace. One per professional in the MVP (see web). */
export async function getCurrentOrgId(): Promise<string | null> {
  if (!supabase) return null;
  // The stored session answers this without a round trip, so a phone with no
  // signal still knows whose workspace it is.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user.id;
  if (!userId) return null;

  const cached = await readCachedOrgId(userId);
  if (cached) return cached;

  const { data } = await supabase.from("memberships").select("org_id").eq("user_id", userId).limit(1).maybeSingle();
  const orgId = (data?.org_id as string) ?? null;
  if (orgId) await cacheOrgId(userId, orgId);
  return orgId;
}

export type TodayResult = {
  consultations: TodayConsultation[];
  /** The server could not be read; `consultations` is the last local copy. */
  offline: boolean;
  /** When that local copy was taken, when it is being shown. */
  cachedAt: string | null;
};

/**
 * The consultations to attend today — the app's home (PRD §11, HOME-SPEC §15.7).
 * Only what still occupies the calendar: scheduled or already in progress. The
 * agenda (web, PRD §9.3) is what puts them there.
 */
export async function listTodayConsultations(orgId: string): Promise<TodayResult> {
  if (!supabase) return { consultations: [], offline: false, cachedAt: null };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);

  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_FIELDS)
    .eq("org_id", orgId)
    .gte("scheduled_for", start.toISOString())
    .lt("scheduled_for", end.toISOString())
    .in("status", ["scheduled", "in_progress"])
    .order("scheduled_for", { ascending: true });

  if (error || !data) {
    const cached = await readCachedTodayConsultations(orgId);
    return {
      consultations: cached?.consultations ?? [],
      offline: true,
      cachedAt: cached?.cachedAt ?? null,
    };
  }

  const consultations = data.map((row) => toConsultation(row as Record<string, unknown>));
  await cacheTodayConsultations(orgId, consultations).catch(() => undefined);
  return { consultations, offline: false, cachedAt: null };
}

export type ConsultationResult =
  | { status: "found"; consultation: TodayConsultation; offline: boolean }
  /** The server answered and this consultation does not exist for her. */
  | { status: "not_found" }
  /** The server could not be read and there is no local copy of this one. */
  | { status: "unavailable" };

export async function getConsultation(consultationId: string, orgId?: string | null): Promise<ConsultationResult> {
  if (!supabase) return { status: "unavailable" };
  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_FIELDS)
    .eq("id", consultationId)
    .maybeSingle();

  if (error) {
    const cached = orgId ? await readCachedConsultation(orgId, consultationId) : null;
    return cached ? { status: "found", consultation: cached, offline: true } : { status: "unavailable" };
  }
  if (!data) return { status: "not_found" };
  return { status: "found", consultation: toConsultation(data as Record<string, unknown>), offline: false };
}

/**
 * Does this patient currently allow audio recording (PRD §9.5)? The app only
 * VERIFIES consent — granting it is a deliberate act on the web, with the
 * patient present and the versioned term shown.
 *
 * `null` means "could not check", never "no": offline, the cached authorization
 * (which the server only issues against an active consent) is what decides, and
 * the database remains the gate on every insert.
 */
export async function hasPatientConsent(
  orgId: string,
  patientId: string,
  slug: "audio-recording" | "ai-processing",
): Promise<boolean | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("has_active_consent", {
    target_org: orgId,
    target_patient: patientId,
    term_slug: slug,
  });
  if (error) return null;
  return Boolean(data);
}

export type AudioAllowance = {
  canStart: boolean;
  minutesRemaining: number;
  promotionAvailable: boolean;
};

/**
 * May this workspace use AI capture right now? The app model contains only the
 * operational answer and remaining minutes, never commercial catalog/provider
 * data.
 */
export async function getAudioAllowance(orgId: string): Promise<AudioAllowance | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("org_audio_allowance", { target_org: orgId });
  if (error || !data) return null;
  const row = data as { can_start: boolean; minutes_remaining: number; trial_available: boolean };
  return {
    canStart: Boolean(row.can_start),
    minutesRemaining: row.minutes_remaining ?? 0,
    promotionAvailable: Boolean(row.trial_available),
  };
}
