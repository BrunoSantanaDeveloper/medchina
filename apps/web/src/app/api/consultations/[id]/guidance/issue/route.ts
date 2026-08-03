import { getLocale, getTranslations } from "next-intl/server";
import { randomUUID } from "node:crypto";

import { recordAudit } from "@/lib/audit";
import { clinicalError } from "@/lib/clinical-route";
import { buildHomeGuidance } from "@/lib/home-guidance";
import { type HomeGuidanceDocumentData, renderHomeGuidancePdf } from "@/lib/home-guidance-document";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import { issueDocument } from "@flyee/documents";

export const maxDuration = 120;

const DOCUMENT_KIND = "home-guidance";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Issue the patient's home-guidance sheet from a VALIDATED plan (PRD §9.8).
 *
 * A second document from the same source, deliberately: the therapeutic plan
 * is the clinical record of what was decided, and this is what the patient
 * takes home. Reusing `issueDocument` means it inherits versioning, the
 * sha256, the verify code and revocation-on-reissue for free — the pipeline is
 * agnostic to the kind.
 *
 * Requires the plan to be validated for the same reason the plan document
 * does: handing out instructions from a draft would circulate advice the
 * professional has not endorsed.
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
    .select("id, org_id, patient_id, started_at")
    .eq("id", id)
    .maybeSingle();
  if (!consultation) return clinicalError("not_found");

  const { data: plan } = await supabase
    .from("consultation_plans")
    .select("id, modalities, status, validated_by, validated_at")
    .eq("consultation_id", id)
    .maybeSingle();
  if (!plan) return clinicalError("plan_not_found");
  if (plan.status !== "validated") return clinicalError("plan_not_validated");

  // Nothing to hand over is not a failure — but issuing an empty sheet would
  // waste the patient's attention and make the document meaningless.
  const sections = buildHomeGuidance(plan.modalities as Record<string, Record<string, unknown>>);
  if (sections.length === 0) return clinicalError("nothing_recorded");

  const [{ data: patient }, { data: org }, { data: professional }] = await Promise.all([
    supabase.from("patients").select("full_name").eq("id", consultation.patient_id).maybeSingle(),
    supabase.from("organizations").select("name, timezone").eq("id", consultation.org_id).maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", plan.validated_by ?? user.id)
      .maybeSingle(),
  ]);
  if (!org?.name?.trim() || !professional?.display_name?.trim()) {
    return clinicalError("document_profile_incomplete");
  }

  const headerKey = request.headers.get("idempotency-key");
  const idempotencyKey = headerKey && UUID_PATTERN.test(headerKey) ? headerKey : randomUUID();
  const { data: documentVersions, error: versionsError } = await supabase
    .from("documents")
    .select("id, version, status, idempotency_key")
    .eq("org_id", consultation.org_id)
    .eq("kind", DOCUMENT_KIND)
    .eq("source_type", "consultation_plan")
    .eq("source_id", plan.id)
    .order("version", { ascending: false });
  if (versionsError) return clinicalError("document_issue_conflict");

  const existingRequest = documentVersions?.find((document) => document.idempotency_key === idempotencyKey);
  const foreignDraft = documentVersions?.find(
    (document) => document.status === "draft" && document.idempotency_key !== idempotencyKey,
  );
  if (foreignDraft) return clinicalError("document_issue_conflict");

  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "product" });
  const dateOptions = { timeZone: org.timezone || "America/Sao_Paulo" } satisfies Intl.DateTimeFormatOptions;
  const issuedAt = new Date().toLocaleDateString(locale, dateOptions);
  const consultationDate = consultation.started_at
    ? new Date(consultation.started_at).toLocaleDateString(locale, dateOptions)
    : "—";

  const makeDocumentData = (version: number, sourceSnapshot: unknown): HomeGuidanceDocumentData => {
    // The snapshot is the authority, exactly as in the plan document: it is
    // what was validated, and it must not drift with later edits.
    const snapshot = isRecord(sourceSnapshot) && isRecord(sourceSnapshot.modalities) ? sourceSnapshot.modalities : {};
    return {
      orgName: org.name,
      patientName: patient?.full_name ?? "—",
      professionalName: professional.display_name,
      consultationDate,
      version,
      issuedAt,
      sections: buildHomeGuidance(snapshot as Record<string, Record<string, unknown>>),
    };
  };

  const result = await issueDocument(
    createServiceClient(),
    {
      orgId: consultation.org_id,
      kind: DOCUMENT_KIND,
      // No patient name in the title: /verify is public (migration 0060).
      title: t("guidance-title"),
      payload: ({ version, sourceSnapshot }) => ({
        planId: plan.id,
        consultationId: id,
        snapshot: makeDocumentData(version, sourceSnapshot),
      }),
      issuedBy: user.id,
      sourceType: "consultation_plan",
      sourceId: plan.id,
      subjectType: "patient",
      subjectId: consultation.patient_id,
      idempotencyKey,
      verifyBaseUrl: new URL(request.url).origin,
    },
    (context) => renderHomeGuidancePdf(makeDocumentData(context.version, context.sourceSnapshot), t, context),
  );
  if (!result.ok) return clinicalError("document_issue_conflict");

  if (existingRequest?.status !== "issued") {
    await recordAudit(supabase, "consultation.guidance.issued", {
      orgId: consultation.org_id,
      entityType: "document",
      entityId: result.documentId,
      metadata: { consultationId: id, planId: plan.id },
    });
  }

  return Response.json({ ok: true, documentId: result.documentId });
}
