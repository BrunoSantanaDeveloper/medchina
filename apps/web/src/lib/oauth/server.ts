import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * OAuth 2.1 authorization server for the MCP connectors (migration 0088,
 * docs/MCP-CONECTORES.md). ChatGPT/Claude register dynamically (RFC 7591),
 * the professional authorizes her workspace on /oauth/authorize, and the
 * token endpoint exchanges PKCE-verified codes for opaque bearer tokens.
 *
 * Tokens follow the capture-link discipline (0053): the raw secret travels
 * once and only its SHA-256 lands in the database. No JWTs — the resource
 * server is this same app, so validation is a lookup, and revocation is
 * immediate instead of waiting out an expiry.
 */

/** Authorization codes: one redirect's lifetime. */
export const OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
/** Access tokens: short — a leaked one dies within the hour. */
export const OAUTH_ACCESS_TTL_S = 60 * 60;
/** Refresh tokens: rotated on every use, reuse revokes the family. */
export const OAUTH_REFRESH_TTL_S = 30 * 24 * 60 * 60;

export type OauthClientRow = {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  client_secret_hash: string | null;
  client_uri: string | null;
  logo_uri: string | null;
};

export function hashOauthSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function mintSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function timingSafeHashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A registered redirect target must be an absolute https URL (http only for
 * loopback dev clients), with no fragment and no wildcard — the registration
 * endpoint is open to the internet, and the redirect list is exactly the
 * attack surface an open registration exposes.
 */
export function isValidRedirectUri(value: string): boolean {
  if (value.includes("*")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

const AUTH_METHODS = new Set(["none", "client_secret_post", "client_secret_basic"]);

export type RegisterClientResult =
  | {
      ok: true;
      client: OauthClientRow;
      /** Present only when the chosen auth method needs one; shown exactly once. */
      clientSecret?: string;
    }
  | { ok: false; error: "invalid_client_metadata" | "invalid_redirect_uri"; description: string };

/** RFC 7591 dynamic registration (ChatGPT and Claude self-register on first connect). */
export async function registerOauthClient(
  service: SupabaseClient,
  body: Record<string, unknown>,
): Promise<RegisterClientResult> {
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (redirectUris.length === 0) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris is required." };
  }
  if (redirectUris.length > 10 || !redirectUris.every(isValidRedirectUri)) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: "Every redirect_uri must be absolute https (or loopback http), without fragments or wildcards.",
    };
  }

  const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (!AUTH_METHODS.has(method)) {
    return { ok: false, error: "invalid_client_metadata", description: "Unsupported token_endpoint_auth_method." };
  }

  const clientName =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 120)
      : "Aplicativo conectado";
  const clientUri = typeof body.client_uri === "string" ? body.client_uri.slice(0, 500) : null;
  const logoUri = typeof body.logo_uri === "string" ? body.logo_uri.slice(0, 500) : null;

  const clientId = `mc_${randomBytes(16).toString("base64url")}`;
  const clientSecret = method === "none" ? undefined : mintSecret("mcs");

  const { data, error } = await service
    .from("oauth_clients")
    .insert({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: method,
      client_secret_hash: clientSecret ? hashOauthSecret(clientSecret) : null,
      client_uri: clientUri,
      logo_uri: logoUri,
    })
    .select(
      "id, client_id, client_name, redirect_uris, token_endpoint_auth_method, client_secret_hash, client_uri, logo_uri",
    )
    .single();
  if (error || !data) {
    return { ok: false, error: "invalid_client_metadata", description: error?.message ?? "Registration failed." };
  }
  return { ok: true, client: data as OauthClientRow, clientSecret };
}

export async function getOauthClient(service: SupabaseClient, clientId: string): Promise<OauthClientRow | null> {
  if (!clientId) return null;
  const { data } = await service
    .from("oauth_clients")
    .select(
      "id, client_id, client_name, redirect_uris, token_endpoint_auth_method, client_secret_hash, client_uri, logo_uri",
    )
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as OauthClientRow | null) ?? null;
}

/** Confidential clients must present their secret; public clients must not have one. */
function verifyClientSecret(client: OauthClientRow, presented: string | null): boolean {
  if (client.token_endpoint_auth_method === "none") return true;
  if (!client.client_secret_hash || !presented) return false;
  return timingSafeHashEquals(client.client_secret_hash, hashOauthSecret(presented));
}

/** Mint the single-use authorization code after the professional approves. */
export async function issueAuthorizationCode(
  service: SupabaseClient,
  input: {
    clientRowId: string;
    orgId: string;
    userId: string;
    codeChallenge: string;
    redirectUri: string;
    scope: string;
  },
): Promise<{ ok: true; code: string } | { ok: false; description: string }> {
  const code = mintSecret("mcc");
  const { error } = await service.from("oauth_grants").insert({
    client_id: input.clientRowId,
    org_id: input.orgId,
    user_id: input.userId,
    code_hash: hashOauthSecret(code),
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: input.redirectUri,
    scope: input.scope,
    expires_at: new Date(Date.now() + OAUTH_CODE_TTL_MS).toISOString(),
  });
  if (error) return { ok: false, description: error.message };
  return { ok: true, code };
}

export type TokenPair = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

type TokenError = { ok: false; error: "invalid_client" | "invalid_grant" | "invalid_request"; description: string };

async function mintTokenPair(
  service: SupabaseClient,
  input: { clientRowId: string; orgId: string; userId: string; scope: string },
): Promise<({ ok: true } & TokenPair) | TokenError> {
  const accessToken = mintSecret("mcat");
  const refreshToken = mintSecret("mcrt");
  const now = Date.now();
  const { error } = await service.from("oauth_tokens").insert({
    client_id: input.clientRowId,
    org_id: input.orgId,
    user_id: input.userId,
    access_token_hash: hashOauthSecret(accessToken),
    refresh_token_hash: hashOauthSecret(refreshToken),
    scope: input.scope,
    access_expires_at: new Date(now + OAUTH_ACCESS_TTL_S * 1000).toISOString(),
    refresh_expires_at: new Date(now + OAUTH_REFRESH_TTL_S * 1000).toISOString(),
  });
  if (error) return { ok: false, error: "invalid_request", description: error.message };
  return {
    ok: true,
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: OAUTH_ACCESS_TTL_S,
    refresh_token: refreshToken,
    scope: input.scope,
  };
}

/** authorization_code exchange: PKCE S256, single use, exact redirect match. */
export async function exchangeAuthorizationCode(
  service: SupabaseClient,
  input: { clientId: string; clientSecret: string | null; code: string; codeVerifier: string; redirectUri: string },
): Promise<({ ok: true } & TokenPair) | TokenError> {
  const client = await getOauthClient(service, input.clientId);
  if (!client || !verifyClientSecret(client, input.clientSecret)) {
    return { ok: false, error: "invalid_client", description: "Unknown client or bad credentials." };
  }
  if (!input.code || !input.codeVerifier) {
    return { ok: false, error: "invalid_request", description: "code and code_verifier are required." };
  }

  const { data: grant } = await service
    .from("oauth_grants")
    .select("id, client_id, org_id, user_id, code_challenge, redirect_uri, scope, expires_at, consumed_at")
    .eq("code_hash", hashOauthSecret(input.code))
    .maybeSingle();

  if (!grant || grant.client_id !== client.id) {
    return { ok: false, error: "invalid_grant", description: "Unknown authorization code." };
  }
  if (grant.consumed_at || new Date(grant.expires_at as string).getTime() < Date.now()) {
    return { ok: false, error: "invalid_grant", description: "Authorization code expired or already used." };
  }
  if (grant.redirect_uri !== input.redirectUri) {
    return { ok: false, error: "invalid_grant", description: "redirect_uri does not match the authorization request." };
  }
  const challenge = createHash("sha256").update(input.codeVerifier, "utf8").digest("base64url");
  if (challenge !== grant.code_challenge) {
    return { ok: false, error: "invalid_grant", description: "PKCE verification failed." };
  }

  // Single use is enforced by the WHERE: a raced duplicate exchange finds the
  // row already consumed and gets nothing.
  const { data: consumed } = await service
    .from("oauth_grants")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", grant.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!consumed) {
    return { ok: false, error: "invalid_grant", description: "Authorization code expired or already used." };
  }

  return mintTokenPair(service, {
    clientRowId: client.id,
    orgId: grant.org_id as string,
    userId: grant.user_id as string,
    scope: grant.scope as string,
  });
}

/**
 * refresh_token grant with rotation. Presenting an ALREADY-ROTATED refresh
 * token is the signature of a stolen token being replayed — the whole family
 * for that client+workspace is revoked (RFC 9700).
 */
export async function refreshAccessToken(
  service: SupabaseClient,
  input: { clientId: string; clientSecret: string | null; refreshToken: string },
): Promise<({ ok: true } & TokenPair) | TokenError> {
  const client = await getOauthClient(service, input.clientId);
  if (!client || !verifyClientSecret(client, input.clientSecret)) {
    return { ok: false, error: "invalid_client", description: "Unknown client or bad credentials." };
  }
  if (!input.refreshToken) {
    return { ok: false, error: "invalid_request", description: "refresh_token is required." };
  }

  const { data: row } = await service
    .from("oauth_tokens")
    .select("id, client_id, org_id, user_id, scope, refresh_expires_at, revoked_at")
    .eq("refresh_token_hash", hashOauthSecret(input.refreshToken))
    .maybeSingle();

  if (!row || row.client_id !== client.id) {
    return { ok: false, error: "invalid_grant", description: "Unknown refresh token." };
  }
  if (row.revoked_at) {
    await service
      .from("oauth_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", client.id)
      .eq("org_id", row.org_id)
      .eq("user_id", row.user_id)
      .is("revoked_at", null);
    return { ok: false, error: "invalid_grant", description: "Refresh token reuse detected; connection revoked." };
  }
  if (!row.refresh_expires_at || new Date(row.refresh_expires_at as string).getTime() < Date.now()) {
    return { ok: false, error: "invalid_grant", description: "Refresh token expired." };
  }

  await service.from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", row.id);
  return mintTokenPair(service, {
    clientRowId: client.id,
    orgId: row.org_id as string,
    userId: row.user_id as string,
    scope: row.scope as string,
  });
}

export type VerifiedAccess = {
  tokenId: string;
  orgId: string;
  userId: string;
  scope: string;
  /** The OAuth client_id string (not the row uuid). */
  clientId: string;
  clientName: string;
};

/** Bearer validation for /api/mcp: live row, not revoked, not expired. */
export async function verifyAccessToken(service: SupabaseClient, token: string): Promise<VerifiedAccess | null> {
  if (!token || !token.startsWith("mcat_")) return null;
  const { data } = await service
    .from("oauth_tokens")
    .select("id, org_id, user_id, scope, access_expires_at, revoked_at, oauth_clients(client_id, client_name)")
    .eq("access_token_hash", hashOauthSecret(token))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  if (new Date(data.access_expires_at as string).getTime() < Date.now()) return null;

  // Best-effort freshness stamp — the /settings connections screen shows it.
  void service
    .from("oauth_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => undefined);

  type ClientRel = { client_id?: string; client_name?: string };
  const clientRel = data.oauth_clients as ClientRel | ClientRel[] | null;
  const client = Array.isArray(clientRel) ? clientRel[0] : clientRel;
  return {
    tokenId: data.id as string,
    orgId: data.org_id as string,
    userId: data.user_id as string,
    scope: data.scope as string,
    clientId: client?.client_id ?? "",
    clientName: client?.client_name || "Assistente externo",
  };
}
