import { NextResponse } from "next/server";

import { registerOauthClient } from "@/lib/oauth/server";
import { createServiceClient } from "@flyee/auth/service";

/**
 * RFC 7591 dynamic client registration. Open by design — the MCP spec expects
 * ChatGPT/Claude to self-register on first connect — so the validation lives
 * in `registerOauthClient` (https-only redirect URIs, no wildcards) and a
 * registration grants NOTHING by itself: data only flows after a professional
 * approves the client on /oauth/authorize.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "invalid_client_metadata", error_description: "Registration payload too large." },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Body must be JSON." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  let service;
  try {
    service = createServiceClient();
  } catch {
    return NextResponse.json(
      { error: "temporarily_unavailable", error_description: "Registration is not configured." },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  const result = await registerOauthClient(service, body);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, error_description: result.description },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(
    {
      client_id: result.client.client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: result.client.client_name,
      redirect_uris: result.client.redirect_uris,
      token_endpoint_auth_method: result.client.token_endpoint_auth_method,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // The secret is shown exactly once; only its hash survives server-side.
      ...(result.clientSecret ? { client_secret: result.clientSecret, client_secret_expires_at: 0 } : {}),
    },
    { status: 201, headers: CORS_HEADERS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
