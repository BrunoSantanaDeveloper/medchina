/**
 * RFC 9728 path-inserted variant: for a resource with a path
 * (https://host/api/mcp), clients may request
 * /.well-known/oauth-protected-resource/api/mcp. Same metadata as the root
 * well-known document.
 */
export { GET, OPTIONS } from "../../route";
