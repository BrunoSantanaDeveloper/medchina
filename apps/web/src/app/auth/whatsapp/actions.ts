"use server";

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { createHash, randomBytes } from "node:crypto";

import { hashClientIp } from "@/lib/live-event-shared";
import { isSignupWhatsAppReady, signupWhatsAppNumber } from "@/lib/signup-whatsapp";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";

/**
 * A code for an account that already exists and still owes its WhatsApp
 * confirmation — the campaign sign-up, after the payment (migration 0122).
 *
 * Unlike the sign-up's own start, this one knows who is asking: the account is
 * taken from the session, never from an argument, so nobody can mint a code
 * that would confirm somebody else's account with their own number.
 */
export type AccountWhatsAppStart =
  | { ok: true; token: string; code: string; number: string }
  | { ok: false; reason: "signed_out" | "not_pending" | "unavailable" | "too_many" };

export async function startAccountWhatsApp(): Promise<AccountWhatsAppStart> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, reason: "signed_out" };

  const number = signupWhatsAppNumber();
  if (!number || !isSignupWhatsAppReady()) return { ok: false, reason: "unavailable" };

  let service;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const token = randomBytes(32).toString("base64url");
  const ipHash = hashClientIp((await headers()).get("x-forwarded-for"));
  const locale = await getLocale().catch(() => "pt-BR");

  const { data, error } = await service.rpc("start_signup_verification", {
    target_email: user.email,
    target_token_hash: createHash("sha256").update(token).digest("hex"),
    target_ip_hash: ipHash,
    target_locale: locale,
    target_user: user.id,
  });
  const result = (data ?? {}) as { ok?: boolean; code?: string };

  if (error || !result.ok || !result.code) {
    if (result.code === "not_pending") return { ok: false, reason: "not_pending" };
    if (result.code === "too_many") return { ok: false, reason: "too_many" };
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, token, code: result.code, number };
}
