/**
 * The message the professional sends to a patient by WhatsApp, as a template
 * she owns.
 *
 * Every WhatsApp path in this product is a HANDOFF (see `whatsapp-link.ts`):
 * the app writes the text, she presses send from her own number. That makes
 * the wording hers, not ours — a fixed sentence written by the product goes
 * out under her name to her patients, in her voice or against it.
 *
 * Tokens are FIXED and locale-neutral (`{name}`, `{date}`, `{time}`) even
 * though she types the message in her own language: the template is stored
 * once and must keep working when she switches the interface language. The UI
 * never asks her to type a token — it offers them as buttons that insert.
 *
 * Substitution is done here, deliberately NOT through next-intl: an ICU
 * formatter throws on an unknown placeholder, and this string is free text a
 * person typed. Here an unknown `{foo}` simply survives into the preview,
 * where she can see it and fix it, instead of breaking the run.
 */

/** Placeholders a reminder/confirmation template may carry. */
export const WHATSAPP_TOKENS = ["name", "date", "time"] as const;
export type WhatsappToken = (typeof WHATSAPP_TOKENS)[number];

/**
 * Upper bound for a stored template. A wa.me deep link carries the message
 * percent-encoded in the URL, and browsers start truncating long URLs well
 * before the limit is interesting — 700 characters is far more than a
 * reminder needs and still safe once encoded.
 */
export const WHATSAPP_TEMPLATE_MAX = 700;

/**
 * What goes to the database: trimmed, length-capped, and `null` when she
 * cleared it. Null is not "no message" — it means "use the product default",
 * which is what a blank field should mean to someone who just wants the
 * original text back.
 */
export function normalizeWhatsappTemplate(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, WHATSAPP_TEMPLATE_MAX);
}

/**
 * Fills the tokens. Unknown placeholders are left exactly as typed — see the
 * module note: the preview is where she catches them.
 */
export function renderWhatsappTemplate(template: string, values: Record<WhatsappToken, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    (WHATSAPP_TOKENS as readonly string[]).includes(token) ? values[token as WhatsappToken] : match,
  );
}

/**
 * Placeholders she typed that this product cannot fill, in order of
 * appearance and without repeats. The UI warns with these rather than
 * refusing to save: `{Dr. Ana}` inside a sentence is a legitimate thing to
 * write, and only she can say whether it was meant as a token.
 */
export function unknownWhatsappTokens(template: string): string[] {
  const found = [...template.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .filter((token) => !(WHATSAPP_TOKENS as readonly string[]).includes(token));
  return [...new Set(found)];
}

/**
 * Inserts a token at the cursor, returning the new text and where the caret
 * should land. Typing `{name}` by hand is a spelling test nobody should sit;
 * the buttons exist so the token is always well formed.
 */
export function insertWhatsappToken(
  template: string,
  token: WhatsappToken,
  selectionStart: number,
  selectionEnd: number,
): { text: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, template.length));
  const end = Math.max(start, Math.min(selectionEnd, template.length));
  const placeholder = `{${token}}`;
  return {
    text: `${template.slice(0, start)}${placeholder}${template.slice(end)}`,
    caret: start + placeholder.length,
  };
}
