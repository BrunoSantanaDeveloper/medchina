import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { BRAND } from "@/brand";
import { MCP_DISCLAIMER } from "@/lib/mcp/gates";
import { registerMcpTools } from "@/lib/mcp/tools";
import { verifyAccessToken } from "@/lib/oauth/server";
import { createServiceClient } from "@flyee/auth/service";

/**
 * The MCP endpoint (Streamable HTTP, stateless) that ChatGPT/Claude talk to
 * after the OAuth dance (docs/MCP-CONECTORES.md). `withMcpAuth` answers an
 * unauthenticated request with 401 + WWW-Authenticate pointing at the
 * protected-resource metadata — that header IS the discovery entry point of
 * the whole connection flow. Tool-level gates (entitlement, scope, rate,
 * quota, consent) live in lib/mcp/gates.ts.
 */

const handler = createMcpHandler(
  (server) => {
    registerMcpTools(server);
  },
  {
    serverInfo: { name: "medchina", version: "1.0.0" },
    instructions: [
      "Servidor do MedChina: biblioteca de Medicina Tradicional Chinesa e prontuário do workspace da profissional conectada.",
      "Regras obrigatórias ao usar estas tools:",
      "- Fundamente respostas de MTC nos trechos devolvidos por consultar_biblioteca_mtc, citando-os como [n]; se nada cobrir a pergunta, diga isso — nunca invente evidência.",
      "- Em dados de prontuário, campo ausente significa 'não informado' — nunca trate ausência como negação.",
      `- ${MCP_DISCLAIMER}`,
    ].join("\n"),
  },
);

const verifyToken = async (_request: Request, bearerToken?: string) => {
  if (!bearerToken) return undefined;
  let service;
  try {
    service = createServiceClient();
  } catch {
    return undefined;
  }
  const access = await verifyAccessToken(service, bearerToken);
  if (!access) return undefined;
  return {
    token: bearerToken,
    clientId: access.clientId,
    scopes: access.scope.split(/\s+/u).filter(Boolean),
    // Read back by every tool via mcpAuthFromExtra — this is the only bridge
    // between the OAuth layer and the tool layer.
    extra: {
      orgId: access.orgId,
      userId: access.userId,
      tokenId: access.tokenId,
      scope: access.scope,
      clientName: access.clientName,
    },
  };
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
  // The ORIGIN only: withMcpAuth appends resourceMetadataPath to this value
  // verbatim, so passing .../api/mcp here would advertise a 404.
  resourceUrl: BRAND.siteUrl,
});

export { authHandler as DELETE, authHandler as GET, authHandler as POST };

/** Embedding + hybrid search comfortably fit; agent retries should not. */
export const maxDuration = 60;
