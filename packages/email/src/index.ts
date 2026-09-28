import { createElement } from "react";
import { Resend } from "resend";

import AdminAccountsDigestEmail, { type AdminAccountsDigestEmailProps } from "./templates/admin-accounts-digest";
import ContactFormEmail, { ContactFormEmailProps } from "./templates/contact-form";
import LiveEventEmail, {
  type LiveEventEmailKind,
  type LiveEventEmailProps,
  liveEventSubject,
} from "./templates/live-event";
import OrgInviteEmail, { OrgInviteEmailProps } from "./templates/org-invite";
import PatientDocumentEmail, { type PatientDocumentEmailProps } from "./templates/patient-document";
import SubscriptionActiveEmail, { type SubscriptionActiveEmailProps } from "./templates/subscription-active";
import TrialLifecycleEmail, { type TrialEmailKind, type TrialLifecycleEmailProps } from "./templates/trial-lifecycle";

export type {
  AdminAccountsDigestEmailProps,
  LiveEventEmailKind,
  LiveEventEmailProps,
  PatientDocumentEmailProps,
  SubscriptionActiveEmailProps,
  TrialEmailKind,
  TrialLifecycleEmailProps,
};

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
 * Confirms that a paid plan is live.
 *
 * Transactional (it confirms a purchase she made), so it carries no
 * unsubscribe and ignores the lifecycle opt-out that governs the trial drip.
 * Returns { sent: false } without failing when RESEND_API_KEY is absent — the
 * in-app notification is written either way, so a missing provider degrades to
 * "she sees it in the bell" instead of taking the webhook down.
 */
export async function sendSubscriptionActiveEmail(
  to: string,
  props: SubscriptionActiveEmailProps,
): Promise<SendResult> {
  if (!isEmailConfigured) {
    return { sent: false };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: DEFAULT_FROM,
    to,
    subject: `Pagamento confirmado — ${props.planName} está ativo`,
    react: createElement(SubscriptionActiveEmail, props),
  });
  if (error) {
    return { sent: false, error: error.message };
  }
  return { sent: true };
}

/**
 * The platform operator's daily digest of accounts that need a decision
 * (trials ending, payments overdue). Internal mail to our own staff, so it
 * carries no unsubscribe; without RESEND_API_KEY the caller still leaves the
 * same digest in the operator's bell, so the alert degrades instead of
 * disappearing.
 */
export async function sendAdminAccountsDigestEmail(
  to: string,
  props: AdminAccountsDigestEmailProps,
): Promise<SendResult> {
  if (!isEmailConfigured) {
    return { sent: false };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: DEFAULT_FROM,
    to,
    subject: `MedChina · ${props.headline}`,
    react: createElement(AdminAccountsDigestEmail, props),
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
export async function sendPatientDocumentEmail(to: string, props: PatientDocumentEmailProps): Promise<SendResult> {
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

/** Resend accepts up to 100 e-mails per batch call. */
const BATCH_SIZE = 100;
/** Resend's default rate limit is 2 requests per second; one batch is one request. */
const BATCH_PAUSE_MS = 700;

export type LiveEventEmailItem = { to: string; props: LiveEventEmailProps };

/**
 * Sends the live event's e-mails (docs/PAGINA-EVENTO.md §8) in batches of up to
 * 100 — one API request per batch — pausing between batches to stay under the
 * provider's rate limit. Hundreds of reminders are a handful of requests, which
 * fits inside one function run.
 *
 * Every message carries `List-Unsubscribe` (+ one-click POST) pointing at the
 * lead-scoped unsubscribe route, so the mail client's own button works too.
 *
 * Returns `sent[i]` for `items[i]`, so the caller marks exactly those as sent
 * (idempotency lives in the caller's columns). A batch the provider refuses is
 * reported as not sent for all of its items — never thrown. Nothing is sent,
 * without failing, when RESEND_API_KEY is absent.
 */
export async function sendLiveEventEmailBatch(
  items: LiveEventEmailItem[],
): Promise<{ sent: boolean[]; error?: string }> {
  const sent = items.map(() => false);
  if (!isEmailConfigured || items.length === 0) return { sent };
  const resend = new Resend(process.env.RESEND_API_KEY);
  let lastError: string | undefined;

  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const chunk = items.slice(start, start + BATCH_SIZE);
    if (start > 0) await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    try {
      const { error } = await resend.batch.send(
        chunk.map((item) => ({
          from: DEFAULT_FROM,
          to: item.to,
          subject: liveEventSubject(item.props.kind, item.props.about),
          react: createElement(LiveEventEmail, item.props),
          headers: {
            "List-Unsubscribe": `<${item.props.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        })),
      );
      if (error) lastError = error.message;
      else chunk.forEach((_, offset) => (sent[start + offset] = true));
    } catch (caught) {
      lastError = caught instanceof Error ? caught.message : String(caught);
    }
  }
  return { sent, ...(lastError ? { error: lastError } : {}) };
}
