/**
 * OAuth scopes of the MCP server (docs/MCP-CONECTORES.md). Pure constants —
 * imported by server code AND by the authorize screen (client-safe).
 *
 * `library:read` is the safe default surface (the MTC library); the two
 * record-touching scopes exist so a future client can ask for LESS than
 * everything. In v1 the consent screen shows and grants what was requested,
 * defaulting to the full set when the client asks for nothing specific —
 * MCP clients typically send no scope parameter.
 */

export const OAUTH_SCOPES = ["library:read", "patients:read", "agenda:read"] as const;

export type OauthScope = (typeof OAUTH_SCOPES)[number];

/** Parse a space-separated scope string into the supported subset (empty/absent → all). */
export function resolveRequestedScopes(scopeParam: string | null | undefined): OauthScope[] {
  const requested = (scopeParam ?? "")
    .split(/\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (requested.length === 0) return [...OAUTH_SCOPES];
  const supported = requested.filter((entry): entry is OauthScope =>
    (OAUTH_SCOPES as readonly string[]).includes(entry),
  );
  return supported.length > 0 ? supported : [...OAUTH_SCOPES];
}

export function scopesToParam(scopes: readonly OauthScope[]): string {
  return scopes.join(" ");
}

export function hasScope(scope: string, wanted: OauthScope): boolean {
  return scope.split(/\s+/u).includes(wanted);
}

/** i18n keys (product namespace) describing each scope in plain language. */
export const SCOPE_LABEL_KEYS: Record<OauthScope, string> = {
  "library:read": "oauth-scope-library",
  "patients:read": "oauth-scope-patients",
  "agenda:read": "oauth-scope-agenda",
};
