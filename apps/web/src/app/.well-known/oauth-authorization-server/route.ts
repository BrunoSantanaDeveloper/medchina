import { NextResponse } from "next/server";

import { BRAND } from "@/brand";
import { OAUTH_SCOPES } from "@/lib/oauth/scopes";

/**
 * RFC 8414 authorization-server metadata — how an MCP client (ChatGPT,
 * Claude) discovers where to register, authorize and exchange tokens
 * (docs/MCP-CONECTORES.md). Values derive from BRAND.siteUrl so a preview
 * deployment advertises itself, never production.
 *
 * CORS is deliberately permissive: metadata is public by definition, and
 * browser-based MCP clients (e.g. the MCP Inspector) preflight it.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-protocol-version",
};

export function GET() {
  const issuer = BRAND.siteUrl;
  return NextResponse.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      registration_endpoint: `${issuer}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      scopes_supported: [...OAUTH_SCOPES],
      service_documentation: `${issuer}/ajuda`,
    },
    { headers: CORS_HEADERS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
