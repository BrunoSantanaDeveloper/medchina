import { createElement } from "react";
import { Resend } from "resend";

import OrgInviteEmail, { OrgInviteEmailProps } from "./templates/org-invite";

/** True when transactional email is configured (server-only env var). */
export const isEmailConfigured = Boolean(process.env.RESEND_API_KEY);

const DEFAULT_FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

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
