import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";

import { BRAND } from "@/brand";

/**
 * RFC 9728 protected-resource metadata: tells an MCP client WHICH
 * authorization server protects /api/mcp. The 401 from the MCP endpoint
 * points here via WWW-Authenticate; from here the client walks to the
 * RFC 8414 metadata next door and starts the OAuth dance.
 */

const handler = protectedResourceHandler({
  authServerUrls: [BRAND.siteUrl],
  resourceUrl: `${BRAND.siteUrl}/api/mcp`,
});

export { handler as GET };

const corsHandler = metadataCorsOptionsRequestHandler();
export function OPTIONS() {
  return corsHandler();
}
