import "server-only";

import { NextResponse } from "next/server";

import { createClient as createCookieClient } from "@flyee/auth/server";
import { type ClinicalErrorCode, isClinicalErrorCode } from "@flyee/clinical";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

const STATUS_BY_CODE: Partial<Record<ClinicalErrorCode, number>> = {
  not_authenticated: 401,
  not_authorized: 403,
  not_found: 404,
  plan_not_found: 404,
  reasoning_not_available: 402,
  trial_not_started: 402,
  audio_allowance_exhausted: 402,
  allowance_unavailable: 402,
  invalid_request: 422,
  nothing_recorded: 422,
  accepted_hypothesis_required: 422,
  consent_required: 422,
  audio_consent_required: 422,
  ai_consent_required: 422,
  consent_acceptance_mismatch: 409,
  consent_term_missing: 422,
  consent_link_invalid: 410,
  consent_terms_changed: 409,
  idempotency_conflict: 409,
  safety_acknowledgement_required: 422,
  invalid_consultation_transition: 409,
  revision_conflict: 409,
  stale_status: 409,
  schedule_conflict: 409,
  not_an_appointment: 409,
  active_consultation_exists: 409,
  patient_unavailable: 409,
  consultation_finalized: 409,
  consultation_cancelled: 409,
  clinical_revision_conflict: 409,
  hypothesis_revision_conflict: 409,
  hypothesis_stale: 409,
  finalization_confirmation_required: 409,
  recording_pending: 409,
  recording_already_open: 409,
  capture_in_progress: 409,
  recording_invalid_state: 409,
  stale_upload_id: 409,
  recording_not_uploaded: 409,
  recording_integrity_failed: 409,
  recording_too_long: 413,
  recording_too_large: 413,
  transcript_not_validated: 409,
  audio_deletion_failed: 409,
  processing_already_claimed: 409,
  processing_claim_lost: 409,
  plan_validated: 409,
  plan_not_validated: 409,
  plan_stale: 409,
  derived_safety_flags_immutable: 409,
  manual_plan_exists: 409,
  document_issue_conflict: 409,
  document_profile_incomplete: 409,
  document_reissue_confirmation_required: 409,
  provider_unavailable: 503,
  usage_record_failed: 503,
  internal_error: 500,
};

export type ClinicalRpcResult = {
  ok?: boolean;
  code?: string;
  [key: string]: unknown;
};

/** Cookie auth for web, bearer auth for the companion app. Both keep RLS. */
export async function createClinicalRequestClient(request: Request): Promise<SupabaseClient> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (token && url && anonKey) {
    return createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  return createCookieClient();
}

export function clinicalError(
  code: ClinicalErrorCode,
  details?: Readonly<Record<string, unknown>>,
  status = STATUS_BY_CODE[code] ?? 400,
) {
  return NextResponse.json({ ok: false, code, error: { code, ...(details ? { details } : {}) } }, { status });
}

export function clinicalRpcResponse(result: ClinicalRpcResult | null | undefined, successStatus = 200) {
  if (result?.ok) return NextResponse.json(result, { status: successStatus });
  const code = isClinicalErrorCode(result?.code) ? result.code : "internal_error";
  const details = result
    ? Object.fromEntries(Object.entries(result).filter(([key]) => !["ok", "code", "error"].includes(key)))
    : undefined;
  return clinicalError(code, details);
}

/** Never send database/provider text to a clinical client. */
export function codeFromUnknown(error: unknown, fallback: ClinicalErrorCode = "internal_error"): ClinicalErrorCode {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return (
    ([...message.matchAll(/[a-z][a-z0-9_]+/g)].map(([candidate]) => candidate).find(isClinicalErrorCode) as
      | ClinicalErrorCode
      | undefined) ?? fallback
  );
}
