"use server";

import { cookies } from "next/headers";

import { recordAudit } from "@/lib/audit";
import { getImpersonationSettings, sessionIdFromAccessToken } from "@/lib/impersonation";
import { notifyUser } from "@/lib/notifications";
import {
  encodeImpersonationMarker,
  IMPERSONATION_MARKER_COOKIE,
  impersonationCookieName,
  parseImpersonationMarker,
} from "@flyee/auth";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";

export type ImpersonationResult = { ok: true } | { ok: false; error: string };

const isServiceConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Starts a support impersonation of `userId`.
 *
 * The session is minted through the auth admin API (a magic link that is never
 * emailed) and stored in a PARALLEL cookie, so the operator's own session is
 * left untouched — leaving is deleting a cookie, not restoring a token, and
 * there is no path where the operator ends up signed out of both accounts.
 *
 * Nothing about the user's own access changes: her existing sessions stay
 * valid, her password is not touched, no email is sent.
 */
export async function startImpersonation(userId: string, reason: string): Promise<ImpersonationResult> {
  if (!isServiceConfigured()) return { ok: false, error: "not-configured" };

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { ok: false, error: "Describe why you need this access (ticket or reported symptom)." };
  }

  // The operator's OWN session authorizes this, never the impersonated one.
  const operatorClient = await createClient({ impersonate: false });
  const {
    data: { user: operator },
  } = await operatorClient.auth.getUser();
  if (!operator) return { ok: false, error: "forbidden" };

  const { data: operatorProfile } = await operatorClient
    .from("profiles")
    .select("is_superadmin, display_name")
    .eq("id", operator.id)
    .maybeSingle();
  if (!operatorProfile?.is_superadmin) return { ok: false, error: "forbidden" };

  if (userId === operator.id) return { ok: false, error: "You are already signed in as this user." };

  const cookieStore = await cookies();
  if (cookieStore.has(IMPERSONATION_MARKER_COOKIE)) {
    return { ok: false, error: "Leave the current support session before starting another." };
  }

  // The impersonated session cannot pass the user's TOTP challenge, so the
  // middleware skips her 2FA step-up for it. That is only defensible if the
  // assurance was established on this side instead: the operator must hold a
  // verified factor AND have passed it in this session.
  const { data: aal } = await operatorClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    return {
      ok: false,
      error:
        "Impersonation requires two-factor authentication on your own account. Enroll at /settings/security and sign in again.",
    };
  }

  const service = createServiceClient();

  const { data: targetUser, error: targetError } = await service.auth.admin.getUserById(userId);
  if (targetError || !targetUser?.user?.email) {
    return { ok: false, error: targetError?.message ?? "This account has no email to sign in with." };
  }
  const targetEmail = targetUser.user.email;

  // A superadmin must not be able to take over another superadmin's account —
  // that is lateral escalation, not support.
  const { data: targetProfile } = await service
    .from("profiles")
    .select("is_superadmin, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (targetProfile?.is_superadmin) {
    return { ok: false, error: "Superadmin accounts cannot be impersonated." };
  }

  // generateLink does NOT send an email and does not invalidate anything the
  // user already has — it just mints a one-time token we redeem ourselves.
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: targetEmail,
  });
  if (linkError || !link?.properties?.hashed_token) {
    return { ok: false, error: linkError?.message ?? "Could not mint a support session." };
  }

  // Redeem it into the parallel cookie.
  const impersonatedClient = await createClient({ impersonate: true });
  const { data: verified, error: verifyError } = await impersonatedClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError || !verified?.session) {
    return { ok: false, error: verifyError?.message ?? "Could not open the support session." };
  }

  const sessionId = sessionIdFromAccessToken(verified.session.access_token);
  if (!sessionId) {
    // Fail closed: without the session id the database cannot recognize this
    // session as impersonated, and the read-only fence would not apply.
    await impersonatedClient.auth.signOut({ scope: "local" });
    await clearImpersonationCookies();
    return { ok: false, error: "Support session rejected: it could not be registered as impersonated." };
  }

  const settings = await getImpersonationSettings();
  const expiresAt = new Date(Date.now() + settings.maxMinutes * 60_000);

  const { data: membership } = await service
    .from("memberships")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  const { error: recordError } = await service.from("impersonation_sessions").insert({
    actor_id: operator.id,
    target_user_id: userId,
    target_org_id: membership?.org_id ?? null,
    reason: trimmedReason,
    session_id: sessionId,
    expires_at: expiresAt.toISOString(),
  });
  if (recordError) {
    // The record IS the fence — an unrecorded session would have full write
    // access, so it must not survive.
    await impersonatedClient.auth.signOut({ scope: "local" });
    await clearImpersonationCookies();
    return { ok: false, error: `Support session rejected: ${recordError.message}` };
  }

  // Her own access log must read "support access", not an unexplained sign-in
  // from an unknown IP (migration 0057 adds the column the trigger fills).
  await service.from("access_events").update({ impersonated_by: operator.id }).eq("session_id", sessionId);

  cookieStore.set(IMPERSONATION_MARKER_COOKIE, encodeImpersonationMarker(sessionId, expiresAt), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: settings.maxMinutes * 60,
  });

  await recordAudit(operatorClient, "admin.user.impersonation_started", {
    entityType: "user",
    entityId: userId,
    metadata: {
      reason: trimmedReason,
      sessionId,
      expiresAt: expiresAt.toISOString(),
      targetEmail,
    },
  });

  // Transparency is part of the feature, not a courtesy: she is told, in her
  // own bell, that support opened her account and why.
  await notifyUser(userId, {
    type: "system",
    title: "Acesso de suporte à sua conta",
    body: `${operatorProfile.display_name ?? "A equipe de suporte"} acessou sua conta para investigar: "${trimmedReason}". O acesso é somente leitura no prontuário e expira em ${settings.maxMinutes} minutos.`,
    href: "/settings/security",
  });

  return { ok: true };
}

/**
 * Ends the support impersonation for this browser. The operator's own session
 * was never touched, so this only revokes the parallel one and drops its
 * cookies — the operator is back in /admin without signing in again.
 */
export async function stopImpersonation(reason: "operator" | "expired" = "operator"): Promise<ImpersonationResult> {
  const cookieStore = await cookies();
  const marker = parseImpersonationMarker(cookieStore.get(IMPERSONATION_MARKER_COOKIE)?.value);
  if (!marker) {
    // No marker but leftover session cookies (marker expired in the browser):
    // still worth clearing, so the next request reads the operator's session.
    await clearImpersonationCookies();
    return { ok: true };
  }
  const sessionId = marker.sessionId;

  const impersonatedClient = await createClient({ impersonate: true });
  const {
    data: { user: impersonated },
  } = await impersonatedClient.auth.getUser();

  // scope: "local" revokes THIS session only. The GoTrue default is "global",
  // which would sign the professional out of every device she owns — ending a
  // support visit must never do that to her.
  await impersonatedClient.auth.signOut({ scope: "local" });
  await clearImpersonationCookies();

  if (isServiceConfigured()) {
    const service = createServiceClient();
    await service
      .from("impersonation_sessions")
      .update({ ended_at: new Date().toISOString(), ended_reason: reason })
      .eq("session_id", sessionId)
      .is("ended_at", null);
  }

  const operatorClient = await createClient({ impersonate: false });
  await recordAudit(operatorClient, "admin.user.impersonation_ended", {
    entityType: "user",
    entityId: impersonated?.id,
    metadata: { sessionId, reason },
  });

  return { ok: true };
}

/** Drops the marker and every chunk of the parallel session cookie. */
async function clearImpersonationCookies() {
  const cookieStore = await cookies();
  const sessionCookie = impersonationCookieName();
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name === IMPERSONATION_MARKER_COOKIE || cookie.name.startsWith(sessionCookie)) {
      cookieStore.set(cookie.name, "", { path: "/", maxAge: 0 });
    }
  }
}
