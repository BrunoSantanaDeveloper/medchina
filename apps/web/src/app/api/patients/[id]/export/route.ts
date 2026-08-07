import { NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";

import { ANAMNESIS_BLOCKS } from "@/lib/anamnesis";
import { recordAudit } from "@/lib/audit";
import { clinicalError } from "@/lib/clinical-route";
import { exportFileName, loadPatientExport } from "@/lib/patient-export";
import { type PatientExportLabels, renderPatientExportPdf } from "@/lib/patient-export-document";
import { createClient } from "@flyee/auth/server";

export const maxDuration = 120;

const ANSWER_SOURCES = ["professional", "patient_report", "professional_voice", "ai_inference"] as const;
const CONSULTATION_STATUSES = [
  "scheduled",
  "in_progress",
  "awaiting_review",
  "draft",
  "finalized",
  "cancelled",
] as const;

/**
 * Exporting one patient's record (PRD §9.10, docs/IMPORT-EXPORT.md §7).
 *
 * Deliberately gated on NOTHING but access to the patient. Reading and taking
 * away her own records must not depend on a plan, on a card that failed or on
 * a cycle that ran out (PRD line 429) — the only boundary is RLS, which
 * decides whether this patient belongs to a workspace she is a member of.
 *
 * `format=json` is the portable payload; `format=pdf` the readable one.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") === "pdf" ? "pdf" : "json";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  // Resolves under RLS: a patient of another workspace is simply not found.
  const { data: scope } = await supabase.from("patients").select("org_id").eq("id", id).maybeSingle();
  if (!scope) return clinicalError("not_found");

  const data = await loadPatientExport(supabase, id);
  if (!data) return clinicalError("not_found");

  await recordAudit(supabase, "patient.exported", {
    orgId: scope.org_id as string,
    entityType: "patient",
    entityId: id,
    metadata: { format, consultations: data.consultations.length },
  });

  const fileName = exportFileName(data.patient.fullName, format);

  if (format === "json") {
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  }

  const t = await getTranslations("product");
  const locale = await getLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale);
  const formatDate = (iso: string) => {
    // Date-only columns (birth date) would shift a day if parsed as UTC noonless
    // instants in a negative offset, so they are pinned to local midnight.
    const parsed = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    return Number.isNaN(parsed.getTime()) ? iso : dateFormatter.format(parsed);
  };

  const labels: PatientExportLabels = {
    title: t("export-title"),
    generatedAt: t("export-generated", { date: formatDate(data.generatedAt) }),
    patientData: t("export-patient-data"),
    birthDate: t("patient-birth"),
    document: t("patient-cpf"),
    phone: t("patient-phone"),
    email: t("patient-email"),
    notes: t("patient-notes"),
    alerts: t("patient-alerts"),
    consultations: t("export-consultations"),
    noConsultations: t("export-no-consultations"),
    chiefComplaint: t("export-chief-complaint"),
    summary: t("consultation-summary"),
    addenda: t("export-addenda"),
    hypotheses: t("export-hypotheses"),
    plan: t("plan-title"),
    attachments: t("attachments-title"),
    documents: t("export-documents"),
    consents: t("export-consents"),
    legacy: t("export-legacy"),
    documentRevoked: t("export-document-revoked"),
    scopeNote: t("export-scope-note"),
    statuses: Object.fromEntries(CONSULTATION_STATUSES.map((status) => [status, t(`status-${status}`)])),
    blocks: Object.fromEntries(ANAMNESIS_BLOCKS.map((block) => [block.key, t(block.title)])),
    fields: Object.fromEntries(
      ANAMNESIS_BLOCKS.flatMap((block) => block.fields.map((field) => [`${block.key}.${field.key}`, t(field.label)])),
    ),
    sources: Object.fromEntries(ANSWER_SOURCES.map((source) => [source, t(`source-${source}`)])),
    consentStates: { active: t("export-consent-active"), revoked: t("export-consent-revoked") },
    page: (current, total) => t("export-page", { current, total }),
    formatDate,
  };

  const pdf = await renderPatientExportPdf(data, labels);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}
