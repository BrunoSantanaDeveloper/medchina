import { createHash, randomBytes, randomUUID } from "node:crypto";

export const PATIENT_CONSENT_SLUGS = ["audio-recording", "ai-processing", "clinical-images"] as const;

export type PatientConsentSlug = (typeof PATIENT_CONSENT_SLUGS)[number];
export type PatientConsentDecisions = Record<PatientConsentSlug, boolean>;
export type PatientConsentSignerRole = "patient" | "legal_representative";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const JSON_MEDIA_TYPE = "application/json";
const MAX_JSON_BYTES = 16 * 1024;

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(value: JsonObject, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function createRequestId(): string {
  return randomUUID();
}

/**
 * The raw capability is returned to the browser once and kept in the URL
 * fragment. Only its SHA-256 digest is sent to PostgreSQL.
 */
export function createPatientConsentToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashPatientConsentToken(token) };
}

export function isPatientConsentToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function hashPatientConsentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** All three independent purposes must be present, even for "authorize all". */
export function parsePatientConsentDecisions(value: unknown): PatientConsentDecisions | null {
  if (!isJsonObject(value) || !hasOnlyKeys(value, PATIENT_CONSENT_SLUGS)) return null;
  if (Object.keys(value).length !== PATIENT_CONSENT_SLUGS.length) return null;
  if (!PATIENT_CONSENT_SLUGS.every((slug) => typeof value[slug] === "boolean")) return null;

  return {
    "audio-recording": value["audio-recording"] as boolean,
    "ai-processing": value["ai-processing"] as boolean,
    "clinical-images": value["clinical-images"] as boolean,
  };
}

export function parseSignerRole(value: unknown): PatientConsentSignerRole | null {
  return value === "patient" || value === "legal_representative" ? value : null;
}

export function parseBoundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximumLength) return null;
  return normalized;
}

export function hasJsonContentType(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === JSON_MEDIA_TYPE;
}

/** Mutations are same-origin only; a bearer-like QR token never enables CORS. */
export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function readBoundedJsonObject(
  request: Request,
  maximumBytes = MAX_JSON_BYTES,
): Promise<JsonObject | null> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return null;

  try {
    const source = await request.text();
    if (new TextEncoder().encode(source).byteLength > maximumBytes) return null;
    const parsed: unknown = JSON.parse(source);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readStringField(value: JsonObject, ...keys: string[]): string | null {
  for (const key of keys) {
    if (typeof value[key] === "string") return value[key];
  }
  return null;
}
