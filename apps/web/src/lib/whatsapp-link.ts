/**
 * wa.me deep links — how this product sends WhatsApp.
 *
 * There is no automated WhatsApp delivery: the Meta Cloud API carries business
 * verification, template approval and per-message cost that the practice does
 * not take on. So every "send by WhatsApp" in the app is a HANDOFF — it opens
 * WhatsApp (Web or the app, whichever the device resolves) with the message
 * already written, and the professional presses send herself.
 *
 * That is not only a workaround. The message leaves from HER number, in a
 * conversation the patient already recognises, which is exactly how a small
 * practice communicates — and nothing is sent behind her back.
 *
 * Phones are persisted as bare digits (packages/fields); local numbers get the
 * Brazilian country code, numbers already carrying 55 pass through, and
 * anything that cannot be a reachable BR number returns null so the caller can
 * offer a copyable link instead of a broken button.
 */
export function whatsappDeepLink(phone: string | null | undefined, message: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  let full: string | null = null;
  if (digits.length === 10 || digits.length === 11) full = `55${digits}`;
  else if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) full = digits;
  if (!full) return null;
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`;
}
