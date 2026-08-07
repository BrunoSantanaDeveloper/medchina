import { NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { randomUUID } from "node:crypto";

import { recordAudit } from "@/lib/audit";
import { clinicalError } from "@/lib/clinical-route";
import { type PrescriptionDocumentData, renderPrescriptionPdf } from "@/lib/prescription-document";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import { issueDocument } from "@flyee/documents";

export const maxDuration = 120;

const DOCUMENT_KIND = "prescription";
const SOURCE_TYPE = "consultation_prescription";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PrescriptionSnapshot = {
  prescriptionId: string;
  consultationId: string;
  kind: "herbal" | "generic";
  title: string;
  items: { name: string; amount: string; notes: string }[];
  posology: string;
  preparation: string;
  notes: string;
  validatedBy: string | null;
  validatedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown) => (typeof value === "string" ? value : "");

function readPrescriptionSnapshot(
  value: unknown,
  expectedPrescriptionId: string,
  expectedConsultationId: string,
): PrescriptionSnapshot {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("document_source_snapshot_invalid");
  if (
    value.prescriptionId !== expectedPrescriptionId ||
    value.consultationId !== expectedConsultationId ||
    (value.kind !== "herbal" && value.kind !== "generic") ||
    typeof value.validatedAt !== "string" ||
    !value.validatedAt
  ) {
    throw new Error("document_source_snapshot_invalid");
  }
  const items = value.items
    .map((entry) => ({
      name: asString(isRecord(entry) ? entry.name : "").trim(),
      amount: asString(isRecord(entry) ? entry.amount : "").trim(),
      notes: asString(isRecord(entry) ? entry.notes : "").trim(),
    }))
    .filter((item) => item.name || item.amount || item.notes);
  return {
    prescriptionId: value.prescriptionId,
    consultationId: value.consultationId,
    kind: value.kind,
    title: asString(value.title).trim(),
    items,
    posology: asString(value.posology).trim(),
    preparation: asString(value.preparation).trim(),
    notes: asString(value.notes).trim(),
    validatedBy: typeof value.validatedBy === "string" ? value.validatedBy : null,
    validatedAt: value.validatedAt,
  };
}

/** Issue or retry one atomic version of a professionally validated prescription. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; prescriptionId: string }> }) {
  const { id, prescriptionId } = await params;
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

  const { data: prescription } = await supabase
    .from("consultation_prescriptions")
    .select("id, kind, status, validated_by")
    .eq("id", prescriptionId)
    .eq("consultation_id", id)
    .maybeSingle();
  if (!prescription) return clinicalError("prescription_not_found");
  if (prescription.status !== "validated") return clinicalError("prescription_not_validated");

  const [{ data: patient }, { data: org }, { data: professional }] = await Promise.all([
    supabase.from("patients").select("full_name").eq("id", consultation.patient_id).maybeSingle(),
    supabase.from("organizations").select("name, timezone").eq("id", consultation.org_id).maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", prescription.validated_by ?? user.id)
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
    .eq("source_type", SOURCE_TYPE)
    .eq("source_id", prescriptionId)
    .order("version", { ascending: false });
  if (versionsError) return clinicalError("document_issue_conflict");

  const existingRequest = documentVersions?.find((document) => document.idempotency_key === idempotencyKey);
  const foreignDraft = documentVersions?.find(
    (document) => document.status === "draft" && document.idempotency_key !== idempotencyKey,
  );
  if (foreignDraft) return clinicalError("document_issue_conflict");

  const latestDocument = documentVersions?.[0];
  if (!existingRequest && latestDocument) {
    const expectedVersion = latestDocument.version + 1;
    if (Number(request.headers.get("confirm-version")) !== expectedVersion) {
      return clinicalError("document_reissue_confirmation_required", { expectedVersion });
    }
  }

  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "product" });
  const dateOptions = { timeZone: org.timezone || "America/Sao_Paulo" } satisfies Intl.DateTimeFormatOptions;
  const dateFmt = (value: string | null) => (value ? new Date(value).toLocaleDateString(locale, dateOptions) : "—");
  const issuedAt = new Date().toLocaleDateString(locale, dateOptions);

  const makeDocumentData = (version: number, sourceSnapshot: unknown): PrescriptionDocumentData => {
    const source = readPrescriptionSnapshot(sourceSnapshot, prescriptionId, id);
    return {
      orgName: org.name,
      patientName: patient?.full_name ?? "—",
      professionalName: professional.display_name,
      consultationDate: dateFmt(consultation.started_at),
      validatedAt: dateFmt(source.validatedAt),
      version,
      issuedAt,
      kindLabel: source.kind === "herbal" ? t("prescription-kind-herbal") : t("prescription-kind-generic"),
      title: source.title,
      items: source.items,
      preparation: source.preparation,
      posology: source.posology,
      notes: source.notes,
    };
  };

  const result = await issueDocument(
    createServiceClient(),
    {
      orgId: consultation.org_id,
      kind: DOCUMENT_KIND,
      title: t("prescription-title"),
      payload: ({ version, sourceSnapshot }) => ({
        prescriptionId,
        consultationId: id,
        snapshot: makeDocumentData(version, sourceSnapshot),
      }),
      issuedBy: user.id,
      sourceType: SOURCE_TYPE,
      sourceId: prescriptionId,
      subjectType: "patient",
      subjectId: consultation.patient_id,
      idempotencyKey,
      verifyBaseUrl: new URL(request.url).origin,
    },
    (context) => renderPrescriptionPdf(makeDocumentData(context.version, context.sourceSnapshot), t, context),
  );
  if (!result.ok) return clinicalError("document_issue_conflict");

  const { data: issued } = await supabase.from("documents").select("version").eq("id", result.documentId).maybeSingle();
  const version = issued?.version ?? 1;
  if (existingRequest?.status !== "issued") {
    await recordAudit(supabase, "consultation.prescription.issued", {
      orgId: consultation.org_id,
      entityType: "document",
      entityId: result.documentId,
      metadata: { consultationId: id, prescriptionId, version, verifyCode: result.verifyCode },
    });
    await supabase.rpc("track_product_event", {
      target_event: "document.issued",
      target_properties: { platform: "web", origin: "consultation" },
    });
  }

  return NextResponse.json({ ok: true, documentId: result.documentId, verifyCode: result.verifyCode, version });
}
