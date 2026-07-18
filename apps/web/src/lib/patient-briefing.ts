import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The pre-consultation briefing (out-of-consultation roadmap, item 3):
 * everything the professional wants at a glance BEFORE the patient walks in,
 * assembled deterministically from the record she can already read (RLS).
 * No AI call — so no consent gate, no cost, every plan.
 */

export type BriefingAlert = { label?: string; severity?: string };

export interface PatientBriefing {
  alerts: BriefingAlert[];
  lastFinalized: {
    id: string;
    when: string;
    chiefComplaint: string | null;
    summary: string | null;
    hypotheses: { pattern: string; correspondence: string; status: string }[];
    planModalities: string[];
  } | null;
  openConsultations: { id: string; status: string; chiefComplaint: string | null }[];
  /** Questions flagged for investigation (ai_gaps of the most recent consultation that has them). */
  gaps: string[];
}

export type BriefingResult = { ok: true; data: PatientBriefing } | { ok: false; error: string };

export async function loadPatientBriefing(supabase: SupabaseClient, patientId: string): Promise<BriefingResult> {
  const [patientResult, finalizedResult, openResult] = await Promise.all([
    supabase.from("patients").select("alerts").eq("id", patientId).maybeSingle(),
    supabase
      .from("consultations")
      .select("id, started_at, scheduled_for, created_at, chief_complaint, summary, ai_gaps")
      .eq("patient_id", patientId)
      .eq("status", "finalized")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("consultations")
      .select("id, status, chief_complaint, ai_gaps, created_at")
      .eq("patient_id", patientId)
      .in("status", ["draft", "in_progress", "awaiting_review"])
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const firstError = patientResult.error ?? finalizedResult.error ?? openResult.error;
  if (firstError) return { ok: false, error: firstError.message };
  if (!patientResult.data) return { ok: false, error: "patient_not_found" };

  const finalized = finalizedResult.data;
  let hypotheses: { pattern: string; correspondence: string; status: string }[] = [];
  let planModalities: string[] = [];
  if (finalized) {
    const [hypothesesResult, planResult] = await Promise.all([
      supabase
        .from("consultation_hypotheses")
        .select("pattern, correspondence, status")
        .eq("consultation_id", finalized.id)
        .in("status", ["accepted", "edited"]),
      supabase
        .from("consultation_plans")
        .select("modalities")
        .eq("consultation_id", finalized.id)
        .eq("status", "validated")
        .maybeSingle(),
    ]);
    hypotheses = (hypothesesResult.data ?? []).map((row) => ({
      pattern: row.pattern as string,
      correspondence: row.correspondence as string,
      status: row.status as string,
    }));
    planModalities = Object.keys((planResult.data?.modalities as Record<string, unknown> | null) ?? {});
  }

  // The questions to investigate come from the MOST RECENT consultation that
  // has them — an open draft outranks the finalized record.
  const gapCandidates = [
    ...(openResult.data ?? []).map((row) => (row.ai_gaps as string[] | null) ?? []),
    (finalized?.ai_gaps as string[] | null) ?? [],
  ];
  const gaps = gapCandidates.find((candidate) => candidate.length > 0) ?? [];

  return {
    ok: true,
    data: {
      alerts: Array.isArray(patientResult.data.alerts) ? (patientResult.data.alerts as BriefingAlert[]) : [],
      lastFinalized: finalized
        ? {
            id: finalized.id as string,
            when: (finalized.started_at ?? finalized.scheduled_for ?? finalized.created_at) as string,
            chiefComplaint: (finalized.chief_complaint as string | null) ?? null,
            summary: (finalized.summary as string | null) ?? null,
            hypotheses,
            planModalities,
          }
        : null,
      openConsultations: (openResult.data ?? []).map((row) => ({
        id: row.id as string,
        status: row.status as string,
        chiefComplaint: (row.chief_complaint as string | null) ?? null,
      })),
      gaps,
    },
  };
}
