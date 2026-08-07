import { normalizePatientName } from "@/lib/patients";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The complete record of ONE patient, for her professional to take away
 * (docs/IMPORT-EXPORT.md §7, PRD §9.10 and §14).
 *
 * Deliberately NOT `loadPatientCase`: that one is shaped for a prompt — five
 * consultations, accepted hypotheses only, rejected drafts dropped to save
 * budget. An export answers a different question ("give me everything I have
 * recorded here"), so it is complete and ordered oldest-first, the way a chart
 * reads.
 *
 * Two exclusions, both deliberate:
 *   * a REJECTED AI draft is not chart content — she threw it away, and
 *     exporting it would resurrect a value she decided against;
 *   * binaries (audio, photos, issued PDFs) are listed with their metadata but
 *     not embedded. Their bytes live in private buckets behind signed URLs;
 *     inlining them would turn a portability file into an unbounded download
 *     and silently republish clinical images. What she gets is the inventory —
 *     enough to know what exists and to ask for it.
 *
 * The payload is versioned because it is a contract with whatever system she
 * moves to next. Adding fields is safe; renaming one is a new version.
 */

export const PATIENT_EXPORT_FORMAT = "medchina.patient-export";
export const PATIENT_EXPORT_VERSION = 1;

export type ExportAnswer = {
  blockKey: string;
  fieldKey: string;
  value: string;
  /** professional | patient_report | professional_voice | ai_inference */
  source: string;
  state: string;
};

export type ExportConsultation = {
  id: string;
  status: string;
  scheduledFor: string | null;
  startedAt: string | null;
  finalizedAt: string | null;
  chiefComplaint: string | null;
  summary: string | null;
  /** A record brought in from another system (0076), never parsed into fields. */
  legacy: { body: string; source: string | null } | null;
  answers: ExportAnswer[];
  addenda: { body: string; reason: string | null; createdAt: string }[];
  hypotheses: { pattern: string; correspondence: string | null; status: string }[];
  plan: { status: string; modalities: string[]; validatedAt: string | null } | null;
  attachments: { kind: string; mime: string; caption: string | null; createdAt: string }[];
  /** Issued or revoked — a revoked document is still part of the history. */
  documents: { kind: string; title: string | null; version: number | null; status: string; issuedAt: string | null }[];
};

export type PatientExport = {
  format: typeof PATIENT_EXPORT_FORMAT;
  version: typeof PATIENT_EXPORT_VERSION;
  generatedAt: string;
  patient: {
    id: string;
    fullName: string;
    birthDate: string | null;
    document: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    alerts: { label: string; severity?: string }[];
    externalRef: string | null;
    createdAt: string | null;
    archivedAt: string | null;
  };
  consultations: ExportConsultation[];
  consents: { slug: string; version: number | null; acceptedAt: string; revokedAt: string | null }[];
};

/** Rows exactly as the queries below return them, so the shaping is testable. */
export type PatientExportRows = {
  patient: Record<string, unknown>;
  consultations: Record<string, unknown>[];
  answers: Record<string, unknown>[];
  addenda: Record<string, unknown>[];
  hypotheses: Record<string, unknown>[];
  plans: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  consents: Record<string, unknown>[];
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

function alertsOf(value: unknown): { label: string; severity?: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return { label: entry };
      if (entry && typeof entry === "object" && "label" in entry) {
        const alert = entry as { label?: unknown; severity?: unknown };
        const label = text(alert.label);
        return label ? { label, ...(text(alert.severity) ? { severity: String(alert.severity) } : {}) } : null;
      }
      return null;
    })
    .filter((alert): alert is { label: string; severity?: string } => alert !== null);
}

/** Oldest first: an exported chart is read forwards, unlike the app timeline. */
function chronologically(a: ExportConsultation, b: ExportConsultation): number {
  const left = a.startedAt ?? a.scheduledFor ?? "";
  const right = b.startedAt ?? b.scheduledFor ?? "";
  return left.localeCompare(right);
}

export function buildPatientExport(rows: PatientExportRows, generatedAt = new Date().toISOString()): PatientExport {
  const by = <T extends Record<string, unknown>>(list: T[], consultationId: string) =>
    list.filter((row) => row.consultation_id === consultationId);

  const consultations = rows.consultations
    .map((row): ExportConsultation => {
      const id = String(row.id);
      const plan = by(rows.plans, id)[0];
      const legacyBody = text(row.legacy_body);

      return {
        id,
        status: String(row.status ?? ""),
        scheduledFor: text(row.scheduled_for),
        startedAt: text(row.started_at),
        finalizedAt: text(row.finalized_at),
        chiefComplaint: text(row.chief_complaint),
        summary: text(row.summary),
        legacy: legacyBody ? { body: legacyBody, source: text(row.legacy_source) } : null,
        answers: by(rows.answers, id).map((answer) => ({
          blockKey: String(answer.block_key ?? ""),
          fieldKey: String(answer.field_key ?? ""),
          value: String(answer.value ?? ""),
          source: String(answer.source ?? "professional"),
          state: String(answer.state ?? "clear"),
        })),
        addenda: by(rows.addenda, id).map((addendum) => ({
          body: String(addendum.body ?? ""),
          reason: text(addendum.reason),
          createdAt: String(addendum.created_at ?? ""),
        })),
        hypotheses: by(rows.hypotheses, id).map((hypothesis) => ({
          pattern: String(hypothesis.pattern ?? ""),
          correspondence: text(hypothesis.correspondence),
          status: String(hypothesis.status ?? ""),
        })),
        plan: plan
          ? {
              status: String(plan.status ?? ""),
              modalities: Object.keys((plan.modalities as Record<string, unknown>) ?? {}),
              validatedAt: text(plan.validated_at),
            }
          : null,
        attachments: by(rows.attachments, id).map((attachment) => ({
          kind: String(attachment.kind ?? ""),
          mime: String(attachment.mime ?? ""),
          caption: text(attachment.caption),
          createdAt: String(attachment.created_at ?? ""),
        })),
        documents: by(rows.documents, id).map((document) => ({
          kind: String(document.kind ?? ""),
          title: text(document.title),
          version: num(document.version),
          status: String(document.status ?? ""),
          issuedAt: text(document.issued_at) ?? text(document.created_at),
        })),
      };
    })
    .sort(chronologically);

  return {
    format: PATIENT_EXPORT_FORMAT,
    version: PATIENT_EXPORT_VERSION,
    generatedAt,
    patient: {
      id: String(rows.patient.id),
      fullName: String(rows.patient.full_name ?? ""),
      birthDate: text(rows.patient.birth_date),
      document: text(rows.patient.document),
      email: text(rows.patient.email),
      phone: text(rows.patient.phone),
      notes: text(rows.patient.notes),
      alerts: alertsOf(rows.patient.alerts),
      externalRef: text(rows.patient.external_ref),
      createdAt: text(rows.patient.created_at),
      archivedAt: text(rows.patient.archived_at),
    },
    consultations,
    consents: rows.consents.map((consent) => {
      const term = (consent.consent_terms ?? {}) as { slug?: unknown; version?: unknown };
      return {
        slug: String(term.slug ?? ""),
        version: num(term.version),
        acceptedAt: String(consent.accepted_at ?? ""),
        revokedAt: text(consent.revoked_at),
      };
    }),
  };
}

/**
 * Loads with the USER's RLS client: a patient outside her workspace simply
 * does not resolve, so the database is the access boundary — not this module.
 */
export async function loadPatientExport(supabase: SupabaseClient, patientId: string): Promise<PatientExport | null> {
  const { data: patient } = await supabase.from("patients").select("*").eq("id", patientId).maybeSingle();
  if (!patient) return null;

  const { data: consultations } = await supabase
    .from("consultations")
    .select("id, status, scheduled_for, started_at, finalized_at, chief_complaint, summary, legacy_body, legacy_source")
    .eq("patient_id", patientId);

  const ids = (consultations ?? []).map((row) => row.id as string);
  const empty = { data: [] as Record<string, unknown>[] };

  const [answers, addenda, hypotheses, plans, attachments, documents, consents] = await Promise.all([
    ids.length
      ? supabase
          .from("anamnesis_answers")
          .select("consultation_id, block_key, field_key, value, source, state")
          // A draft she rejected is not part of the record (see the note above).
          .neq("state", "rejected")
          .in("consultation_id", ids)
      : empty,
    ids.length
      ? supabase
          .from("consultation_addenda")
          .select("consultation_id, body, reason, created_at")
          .in("consultation_id", ids)
      : empty,
    ids.length
      ? supabase
          .from("consultation_hypotheses")
          .select("consultation_id, pattern, correspondence, status")
          .in("consultation_id", ids)
      : empty,
    ids.length
      ? supabase
          .from("consultation_plans")
          .select("consultation_id, status, modalities, validated_at")
          .in("consultation_id", ids)
      : empty,
    ids.length
      ? supabase
          .from("consultation_attachments")
          .select("consultation_id, kind, mime, caption, created_at")
          .is("deleted_at", null)
          .in("consultation_id", ids)
      : empty,
    // A draft was never handed to anyone, so it is not part of the record; a
    // REVOKED one is — 0006 revokes instead of deleting precisely so the
    // history stays true, and an export that hid it would not be the history.
    supabase
      .from("documents")
      .select("consultation_id, kind, title, version, status, issued_at, created_at")
      .eq("patient_id", patientId)
      .in("status", ["issued", "revoked"]),
    supabase
      .from("consent_acceptances")
      .select("accepted_at, revoked_at, consent_terms (slug, version)")
      .eq("subject_type", "patient")
      .eq("subject_id", patientId),
  ]);

  return buildPatientExport({
    patient: patient as Record<string, unknown>,
    consultations: (consultations ?? []) as Record<string, unknown>[],
    answers: (answers.data ?? []) as Record<string, unknown>[],
    addenda: (addenda.data ?? []) as Record<string, unknown>[],
    hypotheses: (hypotheses.data ?? []) as Record<string, unknown>[],
    plans: (plans.data ?? []) as Record<string, unknown>[],
    attachments: (attachments.data ?? []) as Record<string, unknown>[],
    documents: (documents.data ?? []) as Record<string, unknown>[],
    consents: (consents.data ?? []) as Record<string, unknown>[],
  });
}

/** `prontuario-maria-silva-2026-08-07.json` — readable in a downloads folder. */
export function exportFileName(fullName: string, extension: "json" | "pdf", now = new Date()): string {
  const slug = normalizePatientName(fullName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `prontuario-${slug || "paciente"}-${now.toISOString().slice(0, 10)}.${extension}`;
}
