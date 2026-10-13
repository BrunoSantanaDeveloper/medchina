import { formatMobileBrInput, normalizeMobileBr } from "@flyee/fields";

/**
 * The parts of the sign-up WhatsApp flow (migration 0122) that hold no secret
 * and touch no service: shared by the form, the server actions, the webhook
 * and the tests.
 */

export type SignupWhatsAppNumber =
  | { ok: true; digits: string }
  | { ok: false; reason: "empty" | "short" | "long" | "landline" | "invalid" };

/**
 * The number she types at sign-up, as the platform stores it: digits, country
 * code first.
 *
 * Brazil is the default and needs no prefix — a DDD and a mobile, in any of the
 * ways people write one (WhatsApp itself copies "+55 62 99999-9999"). A landline
 * is refused: this is the number WhatsApp reaches her on. Anything that starts
 * with "+" and another country's code is taken as typed, because the product
 * speaks six languages and a Brazilian mask would turn every one of those
 * sign-ups away.
 */
export function parseSignupWhatsApp(value: string | null | undefined): SignupWhatsAppNumber {
  const raw = (value ?? "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && !digits.startsWith("55")) {
    return /^[1-9][0-9]{7,14}$/.test(digits) ? { ok: true, digits } : { ok: false, reason: "invalid" };
  }
  const mobile = normalizeMobileBr(raw);
  return mobile.ok ? { ok: true, digits: `55${mobile.digits}` } : mobile;
}

/** The field as she types: the Brazilian mask, unless she started with "+". */
export function formatSignupWhatsAppInput(value: string): string {
  const raw = value.trimStart();
  if (raw.startsWith("+")) return `+${raw.slice(1).replace(/[^0-9 ()-]/g, "")}`.slice(0, 24);
  return formatMobileBrInput(raw);
}

/** A stored number, back in the shape a Brazilian phone field shows (or null when it is not Brazilian). */
export function brLocalDigits(stored: string | null | undefined): string | null {
  const digits = (stored ?? "").replace(/\D/g, "");
  return /^55[1-9][0-9]{9,10}$/.test(digits) ? digits.slice(2) : null;
}

/** The code the screen shows: 32 symbols without I, O, 0 and 1 (mirrors the SQL alphabet). */
export const SIGNUP_CODE_SHAPE = /^[A-HJ-NP-Z2-9]{6}$/;

/** The browser's verification token: 32 random bytes, base64url. */
export const SIGNUP_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Every code-shaped word of an inbound message. The text is prefilled, but she
 * may edit it, and a translated sentence can carry a six-letter word of its own
 * ("NUMBER"), so ALL candidates go to the database, which only matches a live
 * pending code. Splitting on anything outside ASCII letters and digits is what
 * keeps "Código" from yielding "DIGO…" glued to the next word.
 */
export function extractSignupCodes(text: string | null | undefined): string[] {
  const words = (text ?? "").toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const codes = words.filter((word) => SIGNUP_CODE_SHAPE.test(word));
  return [...new Set(codes)].slice(0, 10);
}

/**
 * The sender as the platform will store it: digits, country code first.
 *
 * WhatsApp still reports many Brazilian mobiles WITHOUT the ninth digit the
 * numbering plan added in 2012-2016 (55 + DDD + 8 digits, starting 6-9). Stored
 * that way, the same person would read as a different number from the one she
 * types everywhere else, and the one-account-per-number rule would not see her.
 */
export function normalizeWhatsAppSender(from: string | null | undefined): string | null {
  const digits = (from ?? "").replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  if (digits.length === 12 && digits.startsWith("55") && /[6-9]/.test(digits[4])) {
    return `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
}
