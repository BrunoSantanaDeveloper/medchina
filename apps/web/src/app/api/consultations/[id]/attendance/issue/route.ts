import { getLocale, getTranslations } from "next-intl/server";
import { randomUUID } from "node:crypto";

import { type AttendanceDocumentData, renderAttendancePdf } from "@/lib/attendance-document";
import { recordAudit } from "@/lib/audit";
import { clinicalError } from "@/lib/clinical-route";
import { DOCUMENT_KINDS } from "@/lib/document-kinds";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import { issueDocument } from "@flyee/documents";

export const maxDuration = 120;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Issue a "declaração de comparecimento" for a consultation that HAPPENED.
 *
 * Requires the record to be finalized: the times it certifies are the record's
 * own (`started_at`/`finalized_at`), and an open consultation has no end. That
 * also makes the document honest by construction — it can only attest to
 * attendance the professional has already closed, never to one in progress.
 *
 * Carries no clinical content by design (see the renderer): its reader is an
 * employer or a school, not the patient.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data: consultation } = await supabase
    .from("consultations")
    .select("id, org_id, patient_id, status, started_at, finalized_at, duration_minutes")
    .eq("id", id)
    .maybeSingle();
  if (!consultation) return clinicalError("not_found");
  // Only a closed consultation has both ends of the period it certifies.
  if (consultation.status !== "finalized") return clinicalError("consultation_finalized");
  if (!consultation.started_at) return clinicalError("nothing_recorded");

  const [{ data: patient }, { data: org }, { data: professional }] = await Promise.all([
    supabase.from("patients").select("full_name").eq("id", consultation.patient_id).maybeSingle(),
    supabase.from("organizations").select("name, timezone").eq("id", consultation.org_id).maybeSingle(),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!org?.name?.trim() || !professional?.display_name?.trim()) {
    return clinicalError("document_profile_incomplete");
  }

  const headerKey = request.headers.get("idempotency-key");
  const idempotencyKey = headerKey && UUID_PATTERN.test(headerKey) ? headerKey : randomUUID();
  const { data: versions, error: versionsError } = await supabase
    .from("documents")
    .select("id, version, status, idempotency_key")
    .eq("org_id", consultation.org_id)
    .eq("kind", DOCUMENT_KINDS.attendance)
    .eq("source_type", "consultation")
    .eq("source_id", consultation.id)
    .order("version", { ascending: false });
  if (versionsError) return clinicalError("document_issue_conflict");

  const existingRequest = versions?.find((document) => document.idempotency_key === idempotencyKey);
  const foreignDraft = versions?.find(
    (document) => document.status === "draft" && document.idempotency_key !== idempotencyKey,
  );
  if (foreignDraft) return clinicalError("document_issue_conflict");

  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "product" });
  const timeZone = org.timezone || "America/Sao_Paulo";
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone });
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone });

  const makeDocumentData = (version: number): AttendanceDocumentData => ({
    orgName: org.name,
    patientName: patient?.full_name ?? "—",
    professionalName: professional.display_name,
    attendanceDate: dateFmt.format(new Date(consultation.started_at as string)),
    startTime: timeFmt.format(new Date(consultation.started_at as string)),
    endTime: consultation.finalized_at ? timeFmt.format(new Date(consultation.finalized_at)) : null,
    durationMinutes: (consultation.duration_minutes as number | null) ?? null,
    version,
    issuedAt: dateFmt.format(new Date()),
  });

  const result = await issueDocument(
    createServiceClient(),
    {
      orgId: consultation.org_id,
      kind: DOCUMENT_KINDS.attendance,
      // Neutral title: /verify is public (migration 0060).
      title: t("attendance-title"),
      payload: ({ version }) => ({ consultationId: id, snapshot: makeDocumentData(version) }),
      issuedBy: user.id,
      sourceType: "consultation",
      sourceId: consultation.id,
      subjectType: "patient",
      subjectId: consultation.patient_id,
      idempotencyKey,
      verifyBaseUrl: new URL(request.url).origin,
    },
    (context) => renderAttendancePdf(makeDocumentData(context.version), t, context),
  );
  if (!result.ok) return clinicalError("document_issue_conflict");

  if (existingRequest?.status !== "issued") {
    await recordAudit(supabase, "consultation.attendance.issued", {
      orgId: consultation.org_id,
      entityType: "document",
      entityId: result.documentId,
      metadata: { consultationId: id },
    });
  }

  return Response.json({ ok: true, documentId: result.documentId });
}
