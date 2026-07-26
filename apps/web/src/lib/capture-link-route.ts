import "server-only";

import { NextResponse } from "next/server";

/**
 * Response helpers for the PUBLIC capture endpoints (`/api/public/capture/*`).
 *
 * These are token-authorized, not session-authorized, so they use their own
 * free-form code vocabulary instead of the clinical error union — and always
 * send the private, no-store, same-origin headers (a bearer flow must never be
 * cacheable or embeddable). The `code` is a stable machine string the phone
 * page maps to a localized message; it never carries provider/DB text.
 */
const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  Vary: "Origin",
} as const;

export type CaptureLinkCode =
  | "capture_link_invalid"
  | "not_authorized"
  | "invalid_request"
  | "not_found"
  | "consultation_finalized"
  | "audio_consent_required"
  | "recording_already_open"
  | "recording_invalid_state"
  | "recording_not_uploaded"
  | "recording_integrity_failed"
  | "recording_too_long"
  | "recording_too_large"
  | "upload_unavailable"
  | "internal_error";

const STATUS_BY_CODE: Record<CaptureLinkCode, number> = {
  capture_link_invalid: 410,
  not_authorized: 403,
  invalid_request: 422,
  not_found: 404,
  consultation_finalized: 409,
  audio_consent_required: 422,
  recording_already_open: 409,
  recording_invalid_state: 409,
  recording_not_uploaded: 409,
  recording_integrity_failed: 409,
  recording_too_long: 413,
  recording_too_large: 413,
  upload_unavailable: 503,
  internal_error: 500,
};

function withPrivateHeaders(response: NextResponse) {
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) response.headers.set(name, value);
  return response;
}

export function captureJson(body: Readonly<Record<string, unknown>>, status = 200) {
  return withPrivateHeaders(NextResponse.json(body, { status }));
}

export function captureError(code: CaptureLinkCode, status?: number) {
  return withPrivateHeaders(NextResponse.json({ ok: false, code }, { status: status ?? STATUS_BY_CODE[code] ?? 400 }));
}

const CAPTURE_CODES = new Set<string>(Object.keys(STATUS_BY_CODE));

/** Map an RPC result / thrown error to a safe capture code, never DB text. */
export function captureCodeFrom(data: unknown, error?: unknown): CaptureLinkCode {
  if (data && typeof data === "object") {
    const code = (data as { code?: unknown }).code;
    if (typeof code === "string" && CAPTURE_CODES.has(code)) return code as CaptureLinkCode;
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = [...message.matchAll(/[a-z][a-z0-9_]+/g)].map(([m]) => m).find((m) => CAPTURE_CODES.has(m));
  return (match as CaptureLinkCode | undefined) ?? "internal_error";
}
