import { NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";

import { recordAudit } from "@/lib/audit";
import { type PlanDocumentData, renderPlanPdf } from "@/lib/plan-document";
import { PLAN_MODALITIES } from "@/lib/plan-modalities";
import { createClient } from "@flyee/auth/server";
import { issueDocument, revokeDocument } from "@flyee/documents";

// Rendering a PDF plus storage.
export const maxDuration = 120;

const DOCUMENT_KIND = "therapeutic-plan";

/**
 * Issue a VALIDATED therapeutic plan as a signed, QR-verifiable document
 * (PRD §9.8/§10.9). Only a validated plan may be issued — a professional action
 * turns a draft into a signed record (PRD §10.10). Reissuing supersedes the
 * previous version (revoked, but still verifiable — the trail is never broken).
 *
 * Runs with the CALLER's client: RLS lets an org owner/admin issue, which in
 * the MVP one-professional workspace is the practitioner herself.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: consultation } = await supabase
    .from("consultations")
    .select("id, org_id, patient_id, status, started_at")
    .eq("id", id)
    .maybeSingle();
  if (!consultation) return NextResponse.json({ error: "Consultation not found." }, { status: 404 });

  const { data: plan } = await supabase
    .from("consultation_plans")
    .select("id, objective, modalities, safety_flags, status, validated_by, validated_at")
    .eq("consultation_id", id)
    .maybeSingle();
  if (!plan) return NextResponse.json({ error: "no_plan" }, { status: 404 });

  // A plan is only a document once the professional has validated it (§10.10).
  if (plan.status !== "validated") {
    return NextResponse.json({ error: "plan_not_validated" }, { status: 409 });
  }

  const [{ data: patient }, { data: org }, { data: professional }] = await Promise.all([
    supabase.from("patients").select("full_name").eq("id", consultation.patient_id).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", consultation.org_id).maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", plan.validated_by ?? user.id)
      .maybeSingle(),
  ]);

  // Localized labels — resolved here so the renderer stays i18n-clean.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "product" });
  const dateFmt = (value: string | null) => (value ? new Date(value).toLocaleDateString(locale) : "—");

  const modalities = (plan.modalities ?? {}) as Record<string, Record<string, unknown>>;
  const documentModalities: PlanDocumentData["modalities"] = PLAN_MODALITIES.filter(
    (m) => modalities[m.slug]?.enabled,
  ).map((m) => {
    const data = modalities[m.slug];
    return {
      slug: m.slug,
      fields: m.fields
        .map((field) => {
          const raw = data[field.key];
          if (field.kind === "list") {
            const list = Array.isArray(raw) ? (raw as string[]) : [];
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

  // Reissue: supersede the previous version so verification flags the old one.
  const { data: prior } = await supabase
    .from("documents")
    .select("id, version")
    .eq("kind", DOCUMENT_KIND)
    .eq("org_id", consultation.org_id)
    .contains("payload", { planId: plan.id })
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (prior?.version ?? 0) + 1;

  const documentData: PlanDocumentData = {
    orgName: org?.name ?? "",
    patientName: patient?.full_name ?? "—",
    professionalName: professional?.display_name || "—",
    consultationDate: dateFmt(consultation.started_at),
    validatedAt: dateFmt(plan.validated_at),
    version,
    issuedAt: new Date().toLocaleDateString(locale),
    objective: (plan.objective ?? "").trim(),
    modalities: documentModalities,
    safetyFlags: ((plan.safety_flags ?? []) as { category: string; matchedText: string }[]).map((f) => ({
      category: f.category,
      matchedText: f.matchedText,
    })),
  };

  const origin = new URL(request.url).origin;

  const result = await issueDocument(
    supabase,
    {
      orgId: consultation.org_id,
      kind: DOCUMENT_KIND,
      title: `${t("plan-title")} — ${documentData.patientName}`,
      // The snapshot lives with the document; it is not exposed by verification.
      payload: { planId: plan.id, consultationId: id, snapshot: documentData },
      issuedBy: user.id,
      parentId: prior?.id,
      version,
      verifyBaseUrl: origin,
    },
    (ctx) => renderPlanPdf(documentData, t, ctx),
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  // The old version is now superseded (still verifiable, flagged as revoked).
  if (prior?.id) await revokeDocument(supabase, prior.id);

  recordAudit(supabase, "consultation.plan.issued", {
    orgId: consultation.org_id,
    entityType: "document",
    entityId: result.documentId,
    metadata: { consultationId: id, planId: plan.id, version, verifyCode: result.verifyCode },
  });

  return NextResponse.json({ documentId: result.documentId, verifyCode: result.verifyCode, version });
}
