import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Since migration 0122, GoTrue cannot create ANY account without a WhatsApp
 * number — the service-role admin API included — and, while the confirmation
 * switch is on, an account that presents no confirmed verification is born
 * PENDING and held at /auth/whatsapp by the middleware. A seeding script wants
 * neither surprise, so it stands in for the message the professional would
 * send: it starts a verification and confirms it with the service role (the
 * same two RPCs the sign-up screen and the webhook call), and hands both the
 * number and the token to createUser in `user_metadata`. The account is then
 * created already confirmed, whatever the switch says.
 *
 *   await admin.auth.admin.createUser({
 *     email, password, email_confirm: true,
 *     user_metadata: { display_name, company, ...(await confirmedSignupMetadata(admin, email)) },
 *   });
 *
 * Each call uses a fresh random Brazilian mobile, because one confirmed
 * WhatsApp number is one account.
 */
export async function confirmedSignupMetadata(
  admin: SupabaseClient,
  email: string,
): Promise<{ whatsapp: string; whatsapp_verification: string }> {
  const token = randomBytes(32).toString("base64url");
  const started = await admin.rpc("start_signup_verification", {
    target_email: email,
    target_token_hash: createHash("sha256").update(token).digest("hex"),
  });
  const code = (started.data as { ok?: boolean; code?: string } | null)?.code;
  if (started.error || !code) {
    throw new Error(`start_signup_verification: ${started.error?.message ?? JSON.stringify(started.data)}`);
  }

  const phone = `55119${String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, "0")}`;
  const confirmed = await admin.rpc("confirm_signup_verification", { target_codes: [code], target_phone: phone });
  if (confirmed.error || !(confirmed.data as { ok?: boolean } | null)?.ok) {
    throw new Error(`confirm_signup_verification: ${confirmed.error?.message ?? JSON.stringify(confirmed.data)}`);
  }
  return { whatsapp: phone, whatsapp_verification: token };
}
