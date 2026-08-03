import { createElement } from "react";
import { Resend } from "resend";

import ContactFormEmail, { ContactFormEmailProps } from "./templates/contact-form";
import OrgInviteEmail, { OrgInviteEmailProps } from "./templates/org-invite";
import PatientDocumentEmail, { type PatientDocumentEmailProps } from "./templates/patient-document";
import TrialLifecycleEmail, { type TrialEmailKind, type TrialLifecycleEmailProps } from "./templates/trial-lifecycle";

export type { PatientDocumentEmailProps, TrialEmailKind, TrialLifecycleEmailProps };

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

const TRIAL_SUBJECTS: Record<TrialEmailKind, string> = {
  welcome: "Seu teste do MedChina Pro começou",
  activation: "Que tal registrar sua primeira consulta?",
  expiring: "Seu teste do MedChina Pro está acabando",
  ended: "Seu teste do Pro terminou — seus dados continuam com você",
};

/**
 * Sends one message of the trial lifecycle drip. Returns { sent: false }
 * without failing when RESEND_API_KEY is absent, so the Inngest drip degrades
 * silently (there is no inline fallback for a scheduled email).
 */
export async function sendTrialEmail(to: string, props: TrialLifecycleEmailProps): Promise<SendResult> {
  if (!isEmailConfigured) {
    return { sent: false };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: DEFAULT_FROM,
    to,
    subject: TRIAL_SUBJECTS[props.kind],
    react: createElement(TrialLifecycleEmail, props),
  });
  if (error) {
    return { sent: false, error: error.message };
  }
  return { sent: true };
}

/**
 * Tells a PATIENT that a document her practitioner issued is waiting for her.
 *
 * Returns { sent: false } without failing when RESEND_API_KEY is absent: the
 * caller always holds a copyable link, so a missing provider degrades to "hand
 * it over another way" instead of losing the delivery entirely.
 */
export async function sendPatientDocumentEmail(
  to: string,
  props: PatientDocumentEmailProps,
): Promise<SendResult> {
  if (!isEmailConfigured) {
    return { sent: false };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: DEFAULT_FROM,
    to,
    // No clinical content in the subject line either — a notification bar is
    // read by whoever is looking at the phone.
    subject: "Seu documento está disponível",
    react: createElement(PatientDocumentEmail, props),
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
