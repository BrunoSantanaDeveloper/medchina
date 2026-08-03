import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { createShareLinkToken } from "@/lib/share-link";
import { createServiceClient } from "@flyee/auth/service";
import { sendPatientDocumentEmail } from "@flyee/email";
import { sendWhatsApp } from "@flyee/whatsapp";

/** A week: long enough for the patient to find the message, short enough to expire. */
const TTL_HOURS = 168;

type Channel = "link" | "whatsapp" | "email";

/**
 * Give the patient her copy of an issued document (PRD §9.8).
 *
 * The professional chooses the channel; the message that leaves carries NO
 * clinical content — only a link that expires and can be revoked. What the
 * patient sees on the other side is `/documento`.
 *
 * The link is minted first and the delivery attempted second, deliberately: a
 * WhatsApp outage must still leave her with a copyable link rather than
 * nothing. The response says what actually happened on each leg.
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

  // "link" means she will share it herself (a copy button in the panel), so
  // there is nothing to deliver and nothing that can fail.
  let delivery: { attempted: boolean; sent: boolean; reason?: string } = { attempted: false, sent: false };

  if (channel !== "link") {
    const patient = await loadPatientContact(supabase, document.subject_type, document.subject_id);
    if (!patient) {
      delivery = { attempted: true, sent: false, reason: "contact_missing" };
    } else if (channel === "whatsapp") {
      delivery = patient.phone
        ? await deliverWhatsApp({ orgId: document.org_id, phone: patient.phone, url, userId: user.id })
        : { attempted: true, sent: false, reason: "contact_missing" };
    } else {
      delivery = patient.email
        ? await deliverEmail({ to: patient.email, url, practice: patient.practiceName, name: patient.firstName })
        : { attempted: true, sent: false, reason: "contact_missing" };
    }
  }

  await recordAudit(supabase, "document.shared", {
    orgId: document.org_id,
    entityType: "document",
    entityId: id,
    metadata: { channel, delivered: delivery.sent, reason: delivery.reason },
  });

  // The URL always comes back: even a failed send leaves her a link to hand
  // over by another route, instead of a dead end with the patient in the room.
  return Response.json({
    ok: true,
    url,
    channel,
    expiresAt: result.expiresAt,
    delivered: delivery.sent,
    deliveryReason: delivery.reason,
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

async function deliverWhatsApp(input: { orgId: string; phone: string; url: string; userId: string }) {
  try {
    // Service role: wa_messages is written by the platform, not the browser.
    const result = await sendWhatsApp(createServiceClient(), {
      orgId: input.orgId,
      to: input.phone,
      text: `Seu documento está disponível: ${input.url}`,
      createdBy: input.userId,
      metadata: { purpose: "document_share" },
    });
    return { attempted: true, sent: result.ok, reason: result.ok ? undefined : "channel_unavailable" };
  } catch {
    return { attempted: true, sent: false, reason: "channel_unavailable" };
  }
}

async function deliverEmail(input: { to: string; url: string; practice: string; name: string }) {
  try {
    const result = await sendPatientDocumentEmail(input.to, {
      url: input.url,
      practiceName: input.practice,
      patientFirstName: input.name,
    });
    return { attempted: true, sent: result.sent, reason: result.sent ? undefined : "channel_unavailable" };
  } catch {
    return { attempted: true, sent: false, reason: "channel_unavailable" };
  }
}
