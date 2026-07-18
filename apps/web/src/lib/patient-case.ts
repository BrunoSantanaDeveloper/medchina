import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The recorded case of ONE patient, loaded for the library's case-review chat
 * (PRD §9.9 + item 2 of the out-of-consultation roadmap).
 *
 * Loaded with the USER's RLS client on purpose: a patient outside the
 * professional's workspace simply does not resolve — the database is the
 * boundary, not this module. Consent (`ai-processing`) and the Pro gate are
 * the chat route's job, BEFORE this loader runs.
 */

const CONSULTATION_LIMIT = 5;
/** Rough prompt budget for the case block; oldest consultations are cut first. */
const CASE_CHAR_BUDGET = 8000;

type PatientAlert = { label?: string; severity?: string };

export interface PatientCase {
  patientId: string;
  fullName: string;
  birthDate: string | null;
  alerts: PatientAlert[];
  consultations: {
    id: string;
    status: string;
    scheduledFor: string | null;
    createdAt: string;
    chiefComplaint: string | null;
    answers: { blockKey: string; fieldKey: string; value: string; source: string }[];
    acceptedHypotheses: { pattern: string; correspondence: string; status: string }[];
    validatedPlanModalities: string[];
  }[];
}

export async function loadPatientCase(supabase: SupabaseClient, patientId: string): Promise<PatientCase | null> {
  const { data: patient } = await supabase
    .from("patients")
    .select("id, full_name, birth_date, alerts")
    .eq("id", patientId)
    .maybeSingle();
  if (!patient) return null;

  const { data: consultations } = await supabase
    .from("consultations")
    .select("id, status, scheduled_for, created_at, chief_complaint")
    .eq("patient_id", patientId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(CONSULTATION_LIMIT);

  const consultationIds = (consultations ?? []).map((row) => row.id as string);
  const [answers, hypotheses, plans] = consultationIds.length
    ? await Promise.all([
        supabase
          .from("anamnesis_answers")
          .select("consultation_id, block_key, field_key, value, source")
          .in("consultation_id", consultationIds),
        supabase
          .from("consultation_hypotheses")
          .select("consultation_id, pattern, correspondence, status")
          .in("consultation_id", consultationIds)
          .in("status", ["accepted", "edited"]),
        supabase
          .from("consultation_plans")
          .select("consultation_id, modalities, status")
          .in("consultation_id", consultationIds)
          .eq("status", "validated"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  return {
    patientId: patient.id as string,
    fullName: patient.full_name as string,
    birthDate: (patient.birth_date as string | null) ?? null,
    alerts: Array.isArray(patient.alerts) ? (patient.alerts as PatientAlert[]) : [],
    consultations: (consultations ?? []).map((row) => ({
      id: row.id as string,
      status: row.status as string,
      scheduledFor: (row.scheduled_for as string | null) ?? null,
      createdAt: row.created_at as string,
      chiefComplaint: (row.chief_complaint as string | null) ?? null,
      answers: (answers.data ?? [])
        .filter((answer) => answer.consultation_id === row.id)
        .map((answer) => ({
          blockKey: answer.block_key as string,
          fieldKey: answer.field_key as string,
          value: answer.value as string,
          source: answer.source as string,
        })),
      acceptedHypotheses: (hypotheses.data ?? [])
        .filter((hypothesis) => hypothesis.consultation_id === row.id)
        .map((hypothesis) => ({
          pattern: hypothesis.pattern as string,
          correspondence: hypothesis.correspondence as string,
          status: hypothesis.status as string,
        })),
      validatedPlanModalities: (plans.data ?? [])
        .filter((plan) => plan.consultation_id === row.id)
        .flatMap((plan) => Object.keys((plan.modalities as Record<string, unknown>) ?? {})),
    })),
  };
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "agendada",
  in_progress: "em atendimento",
  awaiting_review: "aguardando revisão",
  draft: "rascunho",
  finalized: "finalizada",
};

const originLabel = (source: string) =>
  source === "professional_voice" || source === "professional" ? "profissional" : "relato";

function describeConsultation(consultation: PatientCase["consultations"][number]): string {
  const lines: string[] = [];
  const when = consultation.scheduledFor ?? consultation.createdAt;
  lines.push(`Consulta de ${when.slice(0, 10)} (${STATUS_LABEL[consultation.status] ?? consultation.status}):`);
  if (consultation.chiefComplaint) lines.push(`  Queixa principal: ${consultation.chiefComplaint}`);
  for (const answer of consultation.answers) {
    lines.push(`  - ${answer.blockKey}.${answer.fieldKey} [${originLabel(answer.source)}]: ${answer.value}`);
  }
  for (const hypothesis of consultation.acceptedHypotheses) {
    const decided = hypothesis.status === "edited" ? "editada pela profissional" : "aceita pela profissional";
    lines.push(`  Hipótese ${decided}: ${hypothesis.pattern} (correspondência ${hypothesis.correspondence})`);
  }
  if (consultation.validatedPlanModalities.length > 0) {
    lines.push(`  Plano validado com modalidades: ${consultation.validatedPlanModalities.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * The case as a system-prompt block. Newest consultations first; the oldest
 * are dropped when the budget runs out — recency is what case review needs.
 */
export function describePatientCase(patientCase: PatientCase): string {
  const header: string[] = [`Paciente: ${patientCase.fullName}`];
  if (patientCase.birthDate) header.push(`Nascimento: ${patientCase.birthDate}`);
  if (patientCase.alerts.length > 0) {
    const alerts = patientCase.alerts
      .map((alert) => alert.label)
      .filter(Boolean)
      .join("; ");
    if (alerts) header.push(`ALERTAS CLÍNICOS: ${alerts}`);
  }

  const blocks: string[] = [];
  let budget = CASE_CHAR_BUDGET;
  for (const consultation of patientCase.consultations) {
    const block = describeConsultation(consultation);
    if (block.length > budget) break;
    blocks.push(block);
    budget -= block.length;
  }
  if (blocks.length === 0 && patientCase.consultations.length > 0) {
    blocks.push(describeConsultation(patientCase.consultations[0]).slice(0, CASE_CHAR_BUDGET));
  }

  return [
    header.join("\n"),
    "",
    blocks.length > 0 ? blocks.join("\n\n") : "(nenhuma consulta registrada além do cadastro)",
  ].join("\n");
}
