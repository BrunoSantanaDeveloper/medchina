"use server";

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { createHash, randomBytes } from "node:crypto";

import { hashClientIp } from "@/lib/live-event-shared";
import { isSignupWhatsAppConfirmationOn, isSignupWhatsAppReady, signupWhatsAppNumber } from "@/lib/signup-whatsapp";
import { SIGNUP_TOKEN_SHAPE } from "@/lib/signup-whatsapp-shared";
import { createServiceClient } from "@flyee/auth/service";

/**
 * The server half of the sign-up's WhatsApp rules (migration 0122). All of it
 * is public — she has no session yet — so nothing here trusts its input: the
 * e-mail is validated again in SQL, a token is only ever compared by its hash,
 * and the status answers nothing beyond the state of the verification the
 * caller already holds the secret of.
 */

/**
 * What the form does next, once it is valid:
 *
 *  - `create`  — create the account now. Either the confirmation is switched
 *    off (the e-mail confirmation is all there is), or this is a campaign
 *    sign-up on its way to a checkout, which confirms AFTER the payment.
 *  - `confirm` — show the code first; the account is created when her message
 *    arrives.
 *  - `blocked` — the confirmation is on but cannot be started right now.
 */
export type SignupPlan =
  | { step: "create" }
  | { step: "confirm"; token: string; code: string; number: string; expiresAt: string }
  | { step: "blocked"; reason: "unavailable" | "too_many" | "invalid_email" };

export type SignupWhatsAppStatus = {
  /** `retry` is a failed read, not an answer: the screen keeps waiting. */
  status: "pending" | "confirmed" | "phone_taken" | "expired" | "unknown" | "retry";
  phoneHint?: string;
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Whether an ordinary sign-up will be asked to confirm — so the form can say it before the button. */
export async function getSignupWhatsAppConfirmation(): Promise<boolean> {
  return isSignupWhatsAppConfirmationOn();
}

/**
 * Decides the next screen. `deferred` is the form saying "this sign-up is going
 * to a checkout": the confirmation then waits until after the payment. The
 * claim needs no proof — an account created without a confirmation while the
 * switch is on is born PENDING in the database and can do nothing but pay, so
 * lying here buys only that.
 */
export async function planSignup(input: { email: string; deferred: boolean }): Promise<SignupPlan> {
  if (!(await isSignupWhatsAppConfirmationOn())) return { step: "create" };
  if (input.deferred) return { step: "create" };

  const number = signupWhatsAppNumber();
  if (!number || !isSignupWhatsAppReady()) return { step: "blocked", reason: "unavailable" };

  let service;
  try {
    service = createServiceClient();
  } catch {
    return { step: "blocked", reason: "unavailable" };
  }

  // The token stays with the browser and proves the confirmation at sign-up.
  const token = randomBytes(32).toString("base64url");
  const ipHash = hashClientIp((await headers()).get("x-forwarded-for"));
  const locale = await getLocale().catch(() => "pt-BR");

  const { data, error } = await service.rpc("start_signup_verification", {
    target_email: String(input.email ?? "").slice(0, 320),
    target_token_hash: hashToken(token),
    target_ip_hash: ipHash,
    target_locale: locale,
  });
  const result = (data ?? {}) as { ok?: boolean; code?: string; expires_at?: string };

  if (error || !result.ok || !result.code || !result.expires_at) {
    if (result.code === "too_many") return { step: "blocked", reason: "too_many" };
    if (result.code === "invalid_email") return { step: "blocked", reason: "invalid_email" };
    return { step: "blocked", reason: "unavailable" };
  }
  return { step: "confirm", token, code: result.code, number, expiresAt: result.expires_at };
}

/** What a confirmation screen polls while she sends the message. */
export async function readSignupWhatsApp(token: string): Promise<SignupWhatsAppStatus> {
  if (typeof token !== "string" || !SIGNUP_TOKEN_SHAPE.test(token)) return { status: "unknown" };

  let service;
  try {
    service = createServiceClient();
  } catch {
    return { status: "retry" };
  }

  const { data, error } = await service.rpc("signup_verification_status", {
    target_token_hash: hashToken(token),
  });
  if (error || !data) return { status: "retry" };

  const value = data as { status?: string; phone_hint?: string };
  const status = (["pending", "confirmed", "phone_taken", "expired"] as const).find((known) => known === value.status);
  return status ? { status, phoneHint: value.phone_hint } : { status: "unknown" };
}
