import { createElement } from "react";
import { Resend } from "resend";

import ContactFormEmail, { ContactFormEmailProps } from "./templates/contact-form";
import OrgInviteEmail, { OrgInviteEmailProps } from "./templates/org-invite";

/** True when transactional email is configured (server-only env var). */
export const isEmailConfigured = Boolean(process.env.RESEND_API_KEY);

/**
 * A defined-but-empty variable (`EMAIL_FROM=` on its own line — what
 * `vercel env pull` writes for a variable with no value) is not null, so `??`
 * would keep the empty string and every send would be rejected for an empty
 * From. Treat unset and empty as the same thing.
 */
const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;

const DEFAULT_FROM = env("EMAIL_FROM") ?? "onboarding@resend.dev";

export type SendResult = { sent: boolean; error?: string };

/**
 * Sends the organization invite email. Returns { sent: false } without
 * failing when RESEND_API_KEY is absent, so callers can fall back to
 * link sharing (the invite UI always offers a copyable link).
 */
export async function sendOrgInviteEmail(to: string, props: OrgInviteEmailProps): Promise<SendResult> {
  if (!isEmailConfigured) {
    return { sent: false };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: DEFAULT_FROM,
    to,
    subject: `You have been invited to join ${props.orgName}`,
    react: createElement(OrgInviteEmail, props),
  });
  if (error) {
    return { sent: false, error: error.message };
  }
  return { sent: true };
}

/**
 * Forwards a public contact-form submission to CONTACT_FORM_TO (falls back to
 * EMAIL_FROM). Returns { sent: false } without failing when RESEND_API_KEY or
 * the destination is absent — the contact page must tell the visitor to use
 * an alternative channel in that case.
 */
export async function sendContactFormEmail(props: ContactFormEmailProps): Promise<SendResult> {
  const to = env("CONTACT_FORM_TO") ?? env("EMAIL_FROM");
  if (!isEmailConfigured || !to) {
    return { sent: false };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: DEFAULT_FROM,
    to,
    replyTo: props.email,
    subject: `Contact form: ${props.name}`,
    react: createElement(ContactFormEmail, props),
  });
  if (error) {
    return { sent: false, error: error.message };
  }
  return { sent: true };
}
