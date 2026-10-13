"use server";

import { recordAudit } from "@/lib/audit";
import { signupWhatsAppMissing, signupWhatsAppNumber } from "@/lib/signup-whatsapp";
import { createClient } from "@flyee/auth/server";

/**
 * The operator's side of the sign-up's WhatsApp confirmation (migration 0122).
 *
 * The switch itself is a row in `platform_settings`, but two things about it
 * can only be known on the server: whether this deployment can actually
 * RECEIVE a WhatsApp message (environment variables, never sent to a browser),
 * and — because a server action is a public endpoint — whether the caller is
 * an operator at all. The database checks the second again
 * (`set_signup_whatsapp_confirmation` raises for anyone else).
 */

export type SignupWhatsAppAdminState =
  | {
      ok: true;
      enabled: boolean;
      /** Environment variables still missing; the switch stays off while this is not empty. */
      missing: string[];
      /** The number she sends the code to, digits with the country code. */
      number: string | null;
      /** Accounts created without a confirmation and still held at the confirmation screen. */
      waiting: number;
    }
  | { ok: false; reason: "not_authorized" | "failed" };

export type SignupWhatsAppSwitchResult =
  | { ok: true; enabled: boolean; released: number }
  | { ok: false; reason: "not_authorized" | "not_ready" | "failed"; missing?: string[] };

export async function getSignupWhatsAppAdminState(): Promise<SignupWhatsAppAdminState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_authorized" };

  const { data: profile } = await supabase.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
  if (!profile?.is_superadmin) return { ok: false, reason: "not_authorized" };

  const [setting, waiting] = await Promise.all([
    supabase.from("platform_settings").select("value").eq("key", "signup").maybeSingle(),
    supabase
      .from("account_whatsapp")
      .select("user_id", { count: "exact", head: true })
      .eq("confirmation_required", true)
      .is("verified_at", null),
  ]);
  if (setting.error || waiting.error) return { ok: false, reason: "failed" };

  return {
    ok: true,
    enabled: (setting.data?.value as { whatsapp_confirmation?: unknown } | null)?.whatsapp_confirmation === true,
    missing: signupWhatsAppMissing(),
    number: signupWhatsAppNumber(),
    waiting: waiting.count ?? 0,
  };
}

export async function setSignupWhatsAppConfirmation(enabled: boolean): Promise<SignupWhatsAppSwitchResult> {
  // Turning it on with nothing able to receive her message would hold every
  // new sign-up at a screen that can never let it through.
  if (enabled) {
    const missing = signupWhatsAppMissing();
    if (missing.length > 0) return { ok: false, reason: "not_ready", missing };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_signup_whatsapp_confirmation", { target_enabled: enabled });
  if (error) return { ok: false, reason: error.code === "42501" ? "not_authorized" : "failed" };

  const released = Number((data as { released?: number } | null)?.released ?? 0);
  await recordAudit(
    supabase,
    enabled ? "admin.signup.whatsapp_confirmation_enabled" : "admin.signup.whatsapp_confirmation_disabled",
    { entityType: "platform_settings", entityId: "signup", metadata: { released } },
  );
  return { ok: true, enabled, released };
}
