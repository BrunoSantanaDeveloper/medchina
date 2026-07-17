import "server-only";

import { NextResponse } from "next/server";

import { clinicalError, codeFromUnknown } from "@/lib/clinical-route";
import { isJsonObject } from "@/lib/patient-consent-session";
import { type ClinicalErrorCode, isClinicalErrorCode } from "@flyee/clinical";

const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  Vary: "Origin",
} as const;

export function patientConsentJson(body: Readonly<Record<string, unknown>>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_RESPONSE_HEADERS });
}

export function patientConsentError(code: ClinicalErrorCode, status?: number) {
  const response = clinicalError(code, undefined, status);
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) response.headers.set(name, value);
  return response;
}

/** Extract a stable domain code without ever returning provider/database text. */
export function patientConsentRpcCode(data: unknown, error: unknown): ClinicalErrorCode {
  if (isJsonObject(data)) {
    if (isClinicalErrorCode(data.code)) return data.code;
    if (data.code === "invalid_or_expired_link" || data.code === "consent_session_closed") {
      return "consent_link_invalid";
    }
    if (data.code === "invalid_decisions" || data.code === "identity_confirmation_required") {
      return "invalid_request";
    }
  }
  const safeErrorSource = isJsonObject(error) && typeof error.message === "string" ? error.message : error;
  return codeFromUnknown(safeErrorSource, "internal_error");
}
