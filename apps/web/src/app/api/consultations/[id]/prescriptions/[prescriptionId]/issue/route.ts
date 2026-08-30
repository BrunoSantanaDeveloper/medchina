import { NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { randomUUID } from "node:crypto";

import { recordAudit } from "@/lib/audit";
import { clinicalError } from "@/lib/clinical-route";
import { prescriptionText } from "@/lib/prescription";
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
  let idempotencyKey = headerKey && UUID_PATTERN.test(headerKey) ? headerKey : randomUUID();
  const { data: documentVersions, error: versionsError } = await supabase
    .from("documents")
    .select("id, version, status, idempotency_key, issue_lease_expires_at")
    .eq("org_id", consultation.org_id)
    .eq("kind", DOCUMENT_KIND)
    .eq("source_type", SOURCE_TYPE)
    .eq("source_id", prescriptionId)
    .order("version", { ascending: false });
  if (versionsError) return clinicalError("document_issue_conflict");

  const foreignDraft = documentVersions?.find(
    (document) => document.status === "draft" && document.idempotency_key !== idempotencyKey,
  );
  let adoptedKey = false;
  if (foreignDraft) {
    // A reserved draft whose issue attempt DIED (render/upload failure, killed
    // invocation) used to block issuance FOREVER: the idempotency key lives in
    // the page's memory, so after a reload every retry looked like a different
    // request and hit this conflict. If nothing holds the issue lease, the
    // draft is abandoned — ADOPT its key and resume that exact reserved
    // version; the claim RPC still fences a concurrent worker.
    const leaseLive = foreignDraft.issue_lease_expires_at && new Date(foreignDraft.issue_lease_expires_at) > new Date();
    if (leaseLive) return clinicalError("document_issue_conflict");
    if (foreignDraft.idempotency_key) {
      idempotencyKey = foreignDraft.idempotency_key;
      adoptedKey = true;
    }
  }
  const existingRequest = documentVersions?.find((document) => document.idempotency_key === idempotencyKey);

  // Confirmation is about REPLACING something the professional already issued
  // (revoking a visible version). A stranded draft is invisible housekeeping —
  // requiring a confirm header for it turns every recovery into a dead end.
  const latestDocument = documentVersions?.[0];
  const latestIssued = documentVersions?.find((document) => document.status === "issued");
  if (!existingRequest && latestIssued && latestDocument) {
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

  const makeDocumentData = (_version: number, sourceSnapshot: unknown): PrescriptionDocumentData => {
    const source = readPrescriptionSnapshot(sourceSnapshot, prescriptionId, id);
    return {
      orgName: org.name,
      patientName: patient?.full_name ?? "—",
      professionalName: professional.display_name,
      consultationDate: dateFmt(consultation.started_at),
      validatedAt: dateFmt(source.validatedAt),
      issuedAt,
      // The PDF body is ONE text: the professional's own words. Legacy rows
      // with structured fields compose into the same canonical text, so an old
      // prescription prints exactly what a new one would.
      description: prescriptionText(source),
    };
  };

  const issueWithKey = (key: string) =>
    issueDocument(
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
        idempotencyKey: key,
        verifyBaseUrl: new URL(request.url).origin,
      },
      (context) => renderPrescriptionPdf(makeDocumentData(context.version, context.sourceSnapshot), t, context),
    );

  let result = await issueWithKey(idempotencyKey);
  if (!result.ok && adoptedKey && result.error === "prescription_stale" && !latestIssued) {
    // The adopted draft was reserved against an older prescription snapshot,
    // so its idempotency key is pinned to a reservation that can never
    // publish. With nothing issued to protect, reserve the next version fresh.
    result = await issueWithKey(randomUUID());
  }
  if (!result.ok) {
    // The real reason (render, storage, publish fence) was swallowed into one
    // generic conflict — undiagnosable from the UI and absent from the audit
    // trail. Name it in both places operators actually look.
    console.error("[documents] issue failed", { kind: DOCUMENT_KIND, error: result.error });
    await recordAudit(supabase, "document.issue_failed", {
      orgId: consultation.org_id,
      entityType: "consultation",
      entityId: id,
      metadata: { kind: DOCUMENT_KIND, error: result.error },
    });
    return clinicalError("document_issue_conflict");
  }

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
