import { getLocale, getTranslations } from "next-intl/server";

import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { createShareLinkToken } from "@/lib/share-link";
import { whatsappDeepLink } from "@/lib/whatsapp-link";
import { sendPatientDocumentEmail } from "@flyee/email";

/** A week: long enough for the patient to find the message, short enough to expire. */
const TTL_HOURS = 168;

type Channel = "link" | "whatsapp" | "email";

/**
 * Give the patient her copy of an issued document (PRD §9.8).
 *
 * Two channels, two very different mechanics — and the difference is
 * deliberate, not incidental:
 *
 *  - **WhatsApp is a HANDOFF.** There is no automated delivery: the Meta Cloud
 *    API carries business verification, template approval and per-message cost
 *    the practice is not taking on. So this returns a `wa.me` link with the
 *    message already written, the app opens it, and the professional presses
 *    send. It leaves from HER number, in a conversation the patient already
 *    recognises — which is how a small practice actually communicates.
 *  - **E-mail is sent** (Resend), because that channel costs nothing extra and
 *    needs no approval.
 *
 * Either way the message carries NO clinical content — only a link that
 * expires and can be revoked. What the patient sees is `/documento`.
 *
 * The link is minted BEFORE any delivery, so a failing channel still leaves
 * her with something to hand over.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as { channel?: unknown };
  const channel: Channel = body.channel === "whatsapp" || body.channel === "email" ? body.channel : "link";

  // RLS: only a member of the document's org can read it.
  const { data: document } = await supabase
    .from("documents")
    .select("id, org_id, kind, status, subject_type, subject_id")
    .eq("id", id)
    .maybeSingle();
  if (!document) return clinicalError("not_found");
  if (document.status !== "issued") return clinicalError("document_issue_conflict");

  const { token, tokenHash } = createShareLinkToken();
  const { data, error } = await supabase.rpc("create_document_share_link", {
    target_document: id,
    target_token_hash: tokenHash,
    target_channel: channel,
    target_ttl_hours: TTL_HOURS,
  });
  if (error) return clinicalError("internal_error");
  const result = data as { ok?: boolean; code?: string; linkId?: string; expiresAt?: string } | null;
  if (!result?.ok) return clinicalRpcResponse(result);

  const origin = new URL(request.url).origin;
  const url = `${origin}/documento#${token}`;

  const patient = await loadPatientContact(supabase, document.subject_type, document.subject_id);

  let whatsappUrl: string | null = null;
  let emailSent = false;
  let reason: string | undefined;

  if (channel === "whatsapp") {
    // Locale resolved explicitly, as every other route handler here does — a
    // bare getTranslations() in a route has no request locale to read.
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "product" });
    // The message the professional will send, written for her to glance at and
    // press send — no clinical content, just who it is from and the link.
    const message = t("plan-share-whatsapp-message", {
      name: patient?.firstName ?? "",
      practice: patient?.practiceName ?? "",
      url,
    });
    whatsappUrl = whatsappDeepLink(patient?.phone, message);
    if (!whatsappUrl) reason = "contact_missing";
  } else if (channel === "email") {
    if (!patient?.email) {
      reason = "contact_missing";
    } else {
      try {
        const sent = await sendPatientDocumentEmail(patient.email, {
          url,
          practiceName: patient.practiceName,
          patientFirstName: patient.firstName,
        });
        emailSent = sent.sent;
        if (!sent.sent) reason = "channel_unavailable";
      } catch {
        reason = "channel_unavailable";
      }
    }
  }

  await recordAudit(supabase, "document.shared", {
    orgId: document.org_id,
    entityType: "document",
    entityId: id,
    // `delivered` is only ever true for e-mail: a WhatsApp handoff is not a
    // delivery until she presses send, and the app cannot know that.
    metadata: { channel, delivered: emailSent, reason },
  });

  // The URL always comes back: even with no contact on file she has a link to
  // hand over another way, instead of a dead end with the patient in the room.
  return Response.json({
    ok: true,
    url,
    channel,
    expiresAt: result.expiresAt,
    whatsappUrl,
    delivered: emailSent,
    deliveryReason: reason,
  });
}

async function loadPatientContact(
  supabase: Awaited<ReturnType<typeof createClinicalRequestClient>>,
  subjectType: string | null,
  subjectId: string | null,
): Promise<{ phone: string | null; email: string | null; firstName: string; practiceName: string } | null> {
  if (subjectType !== "patient" || !subjectId) return null;
  const { data } = await supabase
    .from("patients")
    .select("full_name, phone, email, org_id, organizations(name)")
    .eq("id", subjectId)
    .maybeSingle();
  if (!data) return null;
  const org = data.organizations as unknown as { name?: string } | null;
  return {
    phone: (data.phone as string | null) ?? null,
    email: (data.email as string | null) ?? null,
    firstName:
      String(data.full_name ?? "")
        .trim()
        .split(" ")[0] ?? "",
    practiceName: org?.name ?? "",
  };
}
