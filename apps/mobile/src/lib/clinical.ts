import type { ConsultationStatus } from "@flyee/clinical";

import { supabase } from "@/lib/supabase";

/**
 * The clinical data the capture app needs (PRD §11). The app's scope is
 * CAPTURE, not review: it reads the day's consultations, verifies consent and
 * writes recordings. Everything it touches is guarded by the same RLS and the
 * same database triggers the web uses — the app is not a second source of truth.
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

/** The professional's workspace. One per professional in the MVP (see web). */
export async function getCurrentOrgId(): Promise<string | null> {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("memberships").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
  return (data?.org_id as string) ?? null;
}

/**
 * The consultations to attend today — the app's home (PRD §11, HOME-SPEC §15.7).
 * Only what still occupies the calendar: scheduled or already in progress. The
 * agenda (web, PRD §9.3) is what puts them there.
 */
export async function listTodayConsultations(orgId: string): Promise<TodayConsultation[]> {
  if (!supabase) return [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);

  const { data, error } = await supabase
    .from("consultations")
    .select("id, status, scheduled_for, started_at, duration_minutes, appointment_note, chief_complaint, patient_id, patients(full_name, alerts)")
    .eq("org_id", orgId)
    .gte("scheduled_for", start.toISOString())
    .lt("scheduled_for", end.toISOString())
    .in("status", ["scheduled", "in_progress"])
    .order("started_at", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => {
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
  });
}

export async function getConsultation(consultationId: string): Promise<TodayConsultation | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("consultations")
    .select("id, status, scheduled_for, started_at, duration_minutes, appointment_note, chief_complaint, patient_id, patients(full_name, alerts)")
    .eq("id", consultationId)
    .maybeSingle();
  if (!data) return null;
  const patient = data.patients as unknown as { full_name: string; alerts: { label: string }[] | null } | null;
  return {
    id: data.id as string,
    status: data.status as ConsultationStatus,
    startedAt: (data.scheduled_for ?? data.started_at) as string,
    durationMinutes: data.duration_minutes as number,
    reason: (data.appointment_note ?? data.chief_complaint) as string | null,
    patientId: data.patient_id as string,
    patientName: patient?.full_name ?? "—",
    alerts: patient?.alerts ?? [],
  };
}

/**
 * Does this patient currently allow audio recording (PRD §9.5)? The app only
 * VERIFIES consent — granting it is a deliberate act on the web, with the
 * patient present and the versioned term shown.
 */
export async function hasPatientConsent(
  orgId: string,
  patientId: string,
  slug: "audio-recording" | "ai-processing",
): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.rpc("has_active_consent", {
    target_org: orgId,
    target_patient: patientId,
    term_slug: slug,
  });
  return Boolean(data);
}

export const hasRecordingConsent = (orgId: string, patientId: string) =>
  hasPatientConsent(orgId, patientId, "audio-recording");

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
