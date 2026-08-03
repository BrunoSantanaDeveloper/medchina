import { NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { randomUUID } from "node:crypto";

import { recordAudit } from "@/lib/audit";
import { clinicalError } from "@/lib/clinical-route";
import { type PlanDocumentData, renderPlanPdf } from "@/lib/plan-document";
import { PLAN_MODALITIES } from "@/lib/plan-modalities";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import { issueDocument } from "@flyee/documents";

export const maxDuration = 120;

const DOCUMENT_KIND = "therapeutic-plan";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PlanSourceSnapshot = {
  planId: string;
  consultationId: string;
  inputRevision: number;
  objective: string | null;
  modalities: Record<string, Record<string, unknown>>;
  safetyFlags: { category: string; matchedText: string }[];
  validatedBy: string | null;
  validatedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readPlanSourceSnapshot(
  value: unknown,
  expectedPlanId: string,
  expectedConsultationId: string,
  expectedValidator: string | null,
): PlanSourceSnapshot {
  if (!isRecord(value) || !isRecord(value.modalities) || !Array.isArray(value.safetyFlags)) {
    throw new Error("document_source_snapshot_invalid");
  }
  const modalities = Object.fromEntries(
    Object.entries(value.modalities).map(([slug, modality]) => {
      if (!isRecord(modality)) throw new Error("document_source_snapshot_invalid");
      return [slug, modality];
    }),
  );
  const safetyFlags = value.safetyFlags.map((flag) => {
    if (!isRecord(flag) || typeof flag.category !== "string" || typeof flag.matchedText !== "string") {
      throw new Error("document_source_snapshot_invalid");
    }
    return { category: flag.category, matchedText: flag.matchedText };
  });
  if (
    value.planId !== expectedPlanId ||
    value.consultationId !== expectedConsultationId ||
    typeof value.inputRevision !== "number" ||
    (typeof value.objective !== "string" && value.objective !== null) ||
    (value.validatedBy !== null && typeof value.validatedBy !== "string") ||
    value.validatedBy !== expectedValidator ||
    typeof value.validatedAt !== "string" ||
    !value.validatedAt
  ) {
    throw new Error("document_source_snapshot_invalid");
  }
  return {
    planId: value.planId,
    consultationId: value.consultationId,
    inputRevision: value.inputRevision,
    objective: value.objective,
    modalities,
    safetyFlags,
    validatedBy: value.validatedBy,
    validatedAt: value.validatedAt,
  };
}

/** Issue or retry one atomic version of a professionally validated plan. */
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
    .select("id, objective, modalities, safety_flags, status, validated_by, validated_at")
    .eq("consultation_id", id)
    .maybeSingle();
  if (!plan) return clinicalError("plan_not_found");
  if (plan.status !== "validated") return clinicalError("plan_not_validated");

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
    .select("id, version, status, idempotency_key, verify_code")
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
  const makeDocumentData = (version: number, sourceSnapshot: unknown): PlanDocumentData => {
    const source = readPlanSourceSnapshot(sourceSnapshot, plan.id, id, plan.validated_by);
    const modalities: PlanDocumentData["modalities"] = PLAN_MODALITIES.filter(
      (modality) => source.modalities[modality.slug]?.enabled,
    ).map((modality) => {
      const data = source.modalities[modality.slug];
      return {
        slug: modality.slug,
        fields: modality.fields
          .map((field) => {
            const raw = data[field.key];
            if (field.kind === "list") {
              const list = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
              return list.length > 0 ? { label: t(field.label), value: "", list } : null;
            }
            if (field.kind === "strategy") {
              return raw ? { label: t(field.label), value: t(`plan-strategy-${raw}`) } : null;
            }
            const value = typeof raw === "string" ? raw.trim() : "";
            return value ? { label: t(field.label), value } : null;
          })
          .filter((field): field is { label: string; value: string; list?: string[] } => field !== null),
      };
    });
    return {
      orgName: org.name,
      patientName: patient?.full_name ?? "—",
      professionalName: professional.display_name,
      consultationDate: dateFmt(consultation.started_at),
      validatedAt: dateFmt(source.validatedAt),
      version,
      issuedAt,
      objective: (source.objective ?? "").trim(),
      modalities,
      safetyFlags: source.safetyFlags,
    };
  };

  const result = await issueDocument(
    createServiceClient(),
    {
      orgId: consultation.org_id,
      kind: DOCUMENT_KIND,
      // No patient name in the title: it is a document-level label, and the
      // public /verify page is reachable by anyone holding the code. The name
      // belongs in the PDF, which is private (migration 0059 also stops the
      // verification RPC from returning titles at all, covering documents
      // issued before this change).
      title: t("plan-title"),
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
    (context) => renderPlanPdf(makeDocumentData(context.version, context.sourceSnapshot), t, context),
  );
  if (!result.ok) return clinicalError("document_issue_conflict");

  const { data: issued } = await supabase.from("documents").select("version").eq("id", result.documentId).maybeSingle();
  const version = issued?.version ?? 1;
  if (existingRequest?.status !== "issued") {
    await recordAudit(supabase, "consultation.plan.issued", {
      orgId: consultation.org_id,
      entityType: "document",
      entityId: result.documentId,
      metadata: { consultationId: id, planId: plan.id, version, verifyCode: result.verifyCode },
    });
    await supabase.rpc("track_product_event", {
      target_event: "document.issued",
      target_properties: { platform: "web", origin: "consultation" },
    });
  }

  return NextResponse.json({
    ok: true,
    documentId: result.documentId,
    verifyCode: result.verifyCode,
    version,
  });
}
