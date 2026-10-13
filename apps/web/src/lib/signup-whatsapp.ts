import "server-only";

import { getTranslations } from "next-intl/server";

import { BRAND } from "@/brand";
import { DEFAULTS } from "@/config";
import { type LocaleOption, LOCALES } from "@/constants";
import { createAnonClient } from "@/lib/public-content";
import { extractSignupCodes, normalizeWhatsAppSender } from "@/lib/signup-whatsapp-shared";
import type { WhatsAppProvider, WhatsAppWebhookEvent } from "@flyee/whatsapp";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The professional's WhatsApp, from sign-up on (migration 0122). Three rules:
 *
 *  1. The NUMBER is mandatory, always — the form asks for it and the database
 *     refuses an account without one.
 *  2. CONFIRMING it is a switch (`platform_settings.signup`, off until the
 *     operator turns it on in /admin/support). While it is off, the sign-up is
 *     confirmed by e-mail as it always was.
 *  3. With the switch on, an ordinary sign-up confirms BEFORE the account
 *     exists; a campaign sign-up (on its way to a checkout) is created at once,
 *     born pending, and confirms AFTER the payment — the middleware holds a
 *     pending account at /auth/whatsapp the moment it leaves the checkout.
 *
 * The confirmation is REVERSED: the screen shows a code and she sends it, from
 * her own WhatsApp, to the platform's number. Her message is what proves the
 * number is hers, it needs no approved template and costs nothing, and the
 * platform's answer is a reply inside the window she opened — never an
 * unsolicited message (docs/PAGINA-EVENTO.md §0.2).
 */

/**
 * The number she sends the code to — the WhatsApp Cloud API number whose
 * webhook reaches /api/webhooks/whatsapp/meta. Digits with the country code.
 * An env var rather than a console setting: it is one half of a pair with the
 * provider credentials (WHATSAPP_META_PHONE_ID), and the two must change
 * together.
 */
export function signupWhatsAppNumber(): string | null {
  const digits = (process.env.WHATSAPP_SIGNUP_NUMBER ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (/^[1-9][0-9]{11,14}$/.test(digits)) return digits;
  return null;
}

/**
 * What still stands between this deployment and a code that can come back.
 * Without a provider able to RECEIVE (and, for Meta, verify the signature of
 * what it receives — the webhook refuses unsigned payloads), a screen would
 * wait for a message that never arrives. The operator's switch refuses to turn
 * on while this list is not empty, and names what is on it. Outside production
 * the number alone is enough: locally the message is simulated with
 * `confirm_signup_verification` (packages/db/migrations/0122).
 */
export function signupWhatsAppMissing(): string[] {
  const missing: string[] = [];
  if (!signupWhatsAppNumber()) missing.push("WHATSAPP_SIGNUP_NUMBER");
  if (process.env.NODE_ENV !== "production") return missing;

  const evolution = Boolean(
    process.env.EVOLUTION_BASE_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE,
  );
  if (evolution) return missing;
  for (const key of ["WHATSAPP_META_TOKEN", "WHATSAPP_META_PHONE_ID", "WHATSAPP_META_APP_SECRET"]) {
    if (!process.env[key]) missing.push(key);
  }
  return missing;
}

export const isSignupWhatsAppReady = (): boolean => signupWhatsAppMissing().length === 0;

/**
 * Is the confirmation switched on? Read with the anon key: the setting is
 * public by design (platform_settings, 0018). A failed read answers "off" —
 * safe, because this only decides which SCREEN the form shows: the database
 * reads the same row itself, and an account created without a confirmation
 * while the switch is on is born pending regardless of what the form believed.
 */
export async function isSignupWhatsAppConfirmationOn(): Promise<boolean> {
  const supabase = createAnonClient();
  if (!supabase) return false;
  const { data, error } = await supabase.from("platform_settings").select("value").eq("key", "signup").maybeSingle();
  if (error) return false;
  return (data?.value as { whatsapp_confirmation?: unknown } | null)?.whatsapp_confirmation === true;
}

const isLocale = (value: unknown): value is LocaleOption => LOCALES.includes(value as LocaleOption);

type ConfirmResult = { ok?: boolean; code?: string; locale?: string } | null;

/**
 * Matches the inbound messages of one webhook delivery against the codes that
 * are waiting — a sign-up about to be created, or an existing account that
 * owes its confirmation — and answers the ones that matched, in the language
 * of the screen that asked, inside the conversation she just opened. Messages
 * that carry no code (a patient, a question) are left alone: they are already
 * in `wa_messages`. Never throws: a webhook that fails is retried by the
 * provider, and a confirmation is idempotent anyway.
 */
export async function confirmSignupsFromWhatsApp(
  service: SupabaseClient,
  provider: WhatsAppProvider,
  events: WhatsAppWebhookEvent[],
): Promise<void> {
  for (const event of events) {
    if (event.type !== "message") continue;
    const codes = extractSignupCodes(event.text);
    const phone = normalizeWhatsAppSender(event.from);
    if (codes.length === 0 || !phone) continue;

    try {
      const { data } = await service.rpc("confirm_signup_verification", {
        target_codes: codes,
        target_phone: phone,
      });
      const result = data as ConfirmResult;
      if (!result || (!result.ok && result.code !== "phone_taken")) continue;

      const locale = isLocale(result.locale) ? result.locale : (DEFAULTS.locale as LocaleOption);
      const t = await getTranslations({ locale, namespace: "auth" });
      const text = result.ok
        ? t("signup-whatsapp-reply-confirmed", { brand: BRAND.name })
        : t("signup-whatsapp-reply-taken", { brand: BRAND.name, url: `${BRAND.siteUrl}/auth/sign-in` });

      const sent = await provider.sendText(event.from, text);
      // The reply joins the log every other message lands in (0008): no org yet.
      await service.from("wa_messages").insert({
        direction: "out",
        to_number: event.from,
        kind: "text",
        text,
        status: sent.ok ? "sent" : "failed",
        error: sent.ok ? null : sent.error,
        provider: provider.name,
        provider_message_id: sent.ok ? (sent.providerMessageId ?? null) : null,
        sent_at: sent.ok ? new Date().toISOString() : null,
        metadata: { purpose: "signup-confirmation" },
      });
    } catch (error) {
      console.warn("signup_whatsapp_confirm_failed", error instanceof Error ? error.message : error);
    }
  }
}
