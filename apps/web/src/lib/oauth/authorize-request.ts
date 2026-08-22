import "server-only";

import { type OauthScope, resolveRequestedScopes } from "@/lib/oauth/scopes";
import { getOauthClient, type OauthClientRow } from "@/lib/oauth/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared parse + validation for the /oauth/authorize screen and its server
 * actions. The action NEVER trusts the form's hidden fields on their own —
 * everything is re-validated against the client registration, so a tampered
 * form cannot smuggle a foreign redirect target past the approval.
 */

export type AuthorizeParams = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopeParam: string;
};

const first = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

export function authorizeParamsFromSearch(source: Record<string, string | string[] | undefined>): AuthorizeParams {
  return {
    responseType: first(source.response_type),
    clientId: first(source.client_id),
    redirectUri: first(source.redirect_uri),
    state: first(source.state),
    codeChallenge: first(source.code_challenge),
    codeChallengeMethod: first(source.code_challenge_method),
    scopeParam: first(source.scope),
  };
}

export function authorizeParamsFromForm(form: FormData): AuthorizeParams {
  const read = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    responseType: read("response_type"),
    clientId: read("client_id"),
    redirectUri: read("redirect_uri"),
    state: read("state"),
    codeChallenge: read("code_challenge"),
    codeChallengeMethod: read("code_challenge_method"),
    scopeParam: read("scope"),
  };
}

export type AuthorizeValidation =
  /** Request is sound — show the consent screen / issue the code. */
  | { ok: true; client: OauthClientRow; scopes: OauthScope[] }
  /**
   * The client or its redirect target could not be trusted — the ONLY safe
   * answer is rendering an error, never redirecting a user to an unverified URL.
   */
  | { ok: false; kind: "render"; error: "invalid_client" | "invalid_redirect" }
  /** Redirect target is verified; the protocol error goes back to the client. */
  | { ok: false; kind: "redirect"; error: "invalid_request"; description: string };

export async function validateAuthorizeRequest(
  service: SupabaseClient,
  params: AuthorizeParams,
): Promise<AuthorizeValidation> {
  const client = await getOauthClient(service, params.clientId);
  if (!client) return { ok: false, kind: "render", error: "invalid_client" };
  if (!params.redirectUri || !client.redirect_uris.includes(params.redirectUri)) {
    return { ok: false, kind: "render", error: "invalid_redirect" };
  }
  if (params.responseType !== "code") {
    return { ok: false, kind: "redirect", error: "invalid_request", description: "response_type must be 'code'." };
  }
  if (!params.codeChallenge || params.codeChallengeMethod !== "S256") {
    return { ok: false, kind: "redirect", error: "invalid_request", description: "PKCE with S256 is required." };
  }
  return { ok: true, client, scopes: resolveRequestedScopes(params.scopeParam) };
}

/** Compose the error redirect back to a VERIFIED redirect_uri. */
export function errorRedirectUrl(redirectUri: string, error: string, description: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
