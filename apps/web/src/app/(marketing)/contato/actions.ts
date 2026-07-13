"use server";

import { isEmailConfigured, sendContactFormEmail } from "@flyee/email";

export type ContactResult = { status: "sent" | "not-configured" | "error" };

/**
 * Forwards the public contact form via @flyee/email. Follows the email
 * package's rule: never throws on missing configuration — the page shows an
 * alternative-channel hint instead.
 */
export async function submitContact(input: { name: string; email: string; message: string }): Promise<ContactResult> {
  const name = input.name.trim().slice(0, 200);
  const email = input.email.trim().slice(0, 200);
  const message = input.message.trim().slice(0, 5000);
  if (!name || !email || !message || !/^\S+@\S+\.\S+$/.test(email)) {
    return { status: "error" };
  }

  if (!isEmailConfigured || !process.env.CONTACT_FORM_TO) {
    return { status: "not-configured" };
  }

  const result = await sendContactFormEmail({ name, email, message });
  return { status: result.sent ? "sent" : "error" };
}
