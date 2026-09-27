"use server";

import { cookies, headers } from "next/headers";

import { COOKIE_KEYS } from "@/constants";
import { decodeAttribution } from "@/lib/attribution";
import { getLiveEvent, liveEventService } from "@/lib/live-event";
import { sendLiveEventEmails } from "@/lib/live-event-email";
import {
  cleanText,
  eventCookieOptions,
  generateEventToken,
  hashClientIp,
  LIVE_EVENT_SLUG,
  personalEventLink,
} from "@/lib/live-event-shared";
import { normalizeMobileBr } from "@flyee/fields";

export type SignupValues = { name: string; phone: string; email: string; marketing: boolean };

export type SignupState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      field?: "name" | "phone" | "email";
      values: SignupValues;
      /** Changes on every failed submit, so the form remounts with the values kept. */
      attempt: number;
    }
  | {
      status: "confirmed";
      /** The name as TYPED, first word — never the stored one (see below). */
      firstName: string;
      /** Id of the registration; the browser `Lead` event reuses it as eventID. Null for the honeypot. */
      registrationId: string | null;
      /** A new registration (fires `Lead` once), not a repeat of an existing one. */
      created: boolean;
      /** Recreates the cookie on another browser/device. Null for the honeypot. */
      personalLink: string | null;
    };

/** The page's own campaign parameters, carried by hidden inputs (this registration's last touch). */
const TOUCH_KEYS = ["origem", "utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

const PHONE_MESSAGES: Record<string, string> = {
  empty: "Digite o número do seu WhatsApp com DDD.",
  invalid: "Digite o número do seu WhatsApp com DDD.",
  short: "Faltou um dígito no número.",
  long: "Sobrou dígito no número. Confira o DDD e o número.",
  landline: "Esse número parece de telefone fixo. Use o número do seu WhatsApp.",
};

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function bounded(value: FormDataEntryValue | null, max: number): string {
  return cleanText(typeof value === "string" ? value : "", max);
}

/**
 * Registration for the live event (docs/PAGINA-EVENTO.md §5).
 *
 * A server action rather than a route handler: the form is a native `<form
 * action>`, so it works without JavaScript (the POST re-renders the page with
 * the confirmation) and swaps in place with it. Server actions carry Next's
 * Origin/Host check, the same posture as `hasSameOrigin` on the public routes.
 *
 * What protects the table, in order: the honeypot (a bot that fills every field
 * gets the confirmation and nothing is written), the phone normalization, and
 * the RPC — service-role only — which enforces the per-network window, the one
 * row per phone, and never rewrites an existing lead. There is no captcha on
 * purpose: for this audience it costs more sign-ups than it saves.
 */
export async function registerForLiveEvent(previous: SignupState, formData: FormData): Promise<SignupState> {
  const values: SignupValues = {
    name: bounded(formData.get("name"), 120).replace(/\s+/g, " "),
    phone: bounded(formData.get("phone"), 40),
    email: bounded(formData.get("email"), 254).toLowerCase(),
    marketing: formData.get("marketing") === "on",
  };
  const attempt = previous.status === "error" ? previous.attempt + 1 : 1;
  const fail = (message: string, field?: "name" | "phone" | "email"): SignupState => ({
    status: "error",
    message,
    field,
    values,
    attempt,
  });
  // Typed, first word. NEVER the stored name: typing someone else's number is
  // allowed (it is a repeat, and changes nothing), so the stored name would
  // reveal who owns any number a stranger tries.
  const firstName = values.name.split(" ")[0]?.slice(0, 40) ?? "";

  // The honeypot: invisible to people, filled by bots. Same screen, no write,
  // no cookie, no event — nothing to learn from.
  if (bounded(formData.get("site"), 200)) {
    return { status: "confirmed", firstName, registrationId: null, created: false, personalLink: null };
  }

  if (!values.name) return fail("Digite seu nome.", "name");
  const phone = normalizeMobileBr(values.phone);
  if (!phone.ok) return fail(PHONE_MESSAGES[phone.reason] ?? PHONE_MESSAGES.invalid, "phone");
  if (values.email && !EMAIL_SHAPE.test(values.email)) {
    return fail("Confira o e-mail, ou deixe o campo em branco.", "email");
  }

  const service = liveEventService();
  const event = await getLiveEvent(LIVE_EVENT_SLUG);
  if (!service || !event) return fail("Não conseguimos registrar agora. Tente de novo em instantes.");

  const touch: Record<string, string> = {};
  for (const key of TOUCH_KEYS) {
    const value = bounded(formData.get(`t_${key}`), 64);
    if (value) touch[key] = value;
  }

  const cookieStore = await cookies();
  const firstTouch = decodeAttribution(cookieStore.get(COOKIE_KEYS.attribution)?.value) ?? {};
  const ipHash = hashClientIp((await headers()).get("x-forwarded-for"));
  const { token, hash } = generateEventToken();

  const { data, error } = await service.rpc("submit_live_event_registration", {
    target_slug: event.slug,
    target_name: values.name,
    target_phone: phone.digits,
    target_email: values.email || null,
    target_marketing: values.marketing,
    target_ip_hash: ipHash,
    target_token_hash: hash,
    target_first_touch: firstTouch,
    target_touch: touch,
  });

  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    registration_id?: string;
    confirmation_email?: string | null;
  };

  if (error || !result.ok) {
    switch (result.code) {
      case "too_many":
        // Honest on purpose: whoever hits this is almost always a person behind
        // a crowded mobile network (CGNAT); the honeypot already handles bots.
        return fail("Muita gente se inscrevendo pela mesma rede agora. Tente de novo em alguns minutos.");
      case "not_open":
        return fail("As inscrições deste evento não estão abertas.");
      case "invalid_phone":
        return fail(PHONE_MESSAGES.invalid, "phone");
      case "invalid_name":
        return fail("Digite seu nome.", "name");
      case "invalid_email":
        return fail("Confira o e-mail, ou deixe o campo em branco.", "email");
      default:
        return fail("Não conseguimos registrar agora. Tente de novo em instantes.");
    }
  }

  cookieStore.set(COOKIE_KEYS.liveEvent, token, eventCookieOptions);

  const registrationId = result.registration_id ?? null;
  const created = result.code === "created";
  // After the live there is no seat to confirm: the e-mail is the recording
  // itself when it is already up, and otherwise it goes with everyone else's
  // when the console sends "recording" (the per-kind column keeps it single).
  const emailKind = event.state === "encerrado" ? (event.recording_url ? "recording" : null) : "confirmation";
  if (created && registrationId && result.confirmation_email && emailKind) {
    // Redundant channel: it must never fail the sign-up.
    try {
      await sendLiveEventEmails({ eventId: event.id, kind: emailKind, registrationIds: [registrationId] });
    } catch {
      // The console can resend; the page already confirmed.
    }
  }

  return { status: "confirmed", firstName, registrationId, created, personalLink: personalEventLink(token) };
}
