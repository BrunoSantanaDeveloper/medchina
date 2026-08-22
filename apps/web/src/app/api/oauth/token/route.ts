import { NextResponse } from "next/server";

import { exchangeAuthorizationCode, refreshAccessToken } from "@/lib/oauth/server";
import { createServiceClient } from "@flyee/auth/service";

/**
 * OAuth 2.1 token endpoint: `authorization_code` (PKCE S256, single-use code)
 * and `refresh_token` (rotation; reuse revokes the family). All the grant
 * logic lives in lib/oauth/server.ts — this route only parses the request
 * shapes clients actually send (form-encoded per spec, JSON tolerated, HTTP
 * Basic for confidential clients).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const NO_STORE = { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache" };

function tokenError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: NO_STORE });
}

async function parseParams(request: Request): Promise<Record<string, string> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === "string")) as Record<
        string,
        string
      >;
    }
    const form = await request.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") params[key] = value;
    }
    return params;
  } catch {
    return null;
  }
}

/** client_secret_basic support: credentials may arrive in the Authorization header. */
function basicCredentials(request: Request): { clientId: string; clientSecret: string } | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const params = await parseParams(request);
  if (!params) return tokenError("invalid_request", "Unreadable request body.");

  const basic = basicCredentials(request);
  const clientId = basic?.clientId ?? params.client_id ?? "";
  const clientSecret = basic?.clientSecret ?? params.client_secret ?? null;
  if (!clientId) return tokenError("invalid_client", "client_id is required.", 401);

  let service;
  try {
    service = createServiceClient();
  } catch {
    return tokenError("temporarily_unavailable", "Token endpoint is not configured.", 503);
  }

  const grantType = params.grant_type ?? "";
  const result =
    grantType === "authorization_code"
      ? await exchangeAuthorizationCode(service, {
          clientId,
          clientSecret,
          code: params.code ?? "",
          codeVerifier: params.code_verifier ?? "",
          redirectUri: params.redirect_uri ?? "",
        })
      : grantType === "refresh_token"
        ? await refreshAccessToken(service, { clientId, clientSecret, refreshToken: params.refresh_token ?? "" })
        : null;

  if (!result) return tokenError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  if (!result.ok) {
    return tokenError(result.error, result.description, result.error === "invalid_client" ? 401 : 400);
  }

  return NextResponse.json(
    {
      access_token: result.access_token,
      token_type: result.token_type,
      expires_in: result.expires_in,
      refresh_token: result.refresh_token,
      scope: result.scope,
    },
    { headers: NO_STORE },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
