import { createClinicalRequestClient } from "@/lib/clinical-route";
import { patientConsentError, patientConsentJson, patientConsentRpcCode } from "@/lib/patient-consent-route";
import {
  hasSameOrigin,
  isJsonObject,
  isUuid,
  parsePatientConsentDecisions,
  readStringField,
} from "@/lib/patient-consent-session";

const SESSION_STATUSES = new Set(["pending", "completed", "cancelled", "expired", "invalidated"]);

type RouteParams = { params: Promise<{ id: string; sessionId: string }> };

async function authenticatedClient(request: Request) {
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, authenticated: Boolean(user) };
}

export async function GET(request: Request, { params }: RouteParams) {
  const { id: patientId, sessionId } = await params;
  if (!isUuid(patientId) || !isUuid(sessionId)) return patientConsentError("invalid_request");

  const { supabase, authenticated } = await authenticatedClient(request);
  if (!authenticated) return patientConsentError("not_authenticated");

  const { data, error } = await supabase.rpc("get_patient_consent_session_status", {
    target_session: sessionId,
  });
  if (error || !isJsonObject(data) || data.ok !== true) {
    return patientConsentError(patientConsentRpcCode(data, error));
  }

  const responsePatientId = readStringField(data, "patientId", "patient_id");
  if (responsePatientId && responsePatientId !== patientId) return patientConsentError("not_found");

  const status = readStringField(data, "status");
  if (!status || !SESSION_STATUSES.has(status)) return patientConsentError("internal_error");

  const decisions = parsePatientConsentDecisions(data.decisions);
  const expiresAt = readStringField(data, "expiresAt", "expires_at");
  const openedAt = readStringField(data, "openedAt", "opened_at");
  const completedAt = readStringField(data, "completedAt", "completed_at");

  return patientConsentJson({
    ok: true,
    sessionId,
    status,
    ...(expiresAt ? { expiresAt } : {}),
    ...(openedAt ? { openedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(decisions ? { decisions } : {}),
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  if (!hasSameOrigin(request)) return patientConsentError("not_authorized");

  const { id: patientId, sessionId } = await params;
  if (!isUuid(patientId) || !isUuid(sessionId)) return patientConsentError("invalid_request");

  const { supabase, authenticated } = await authenticatedClient(request);
  if (!authenticated) return patientConsentError("not_authenticated");

  const { data: statusData, error: statusError } = await supabase.rpc("get_patient_consent_session_status", {
    target_session: sessionId,
  });
  if (statusError || !isJsonObject(statusData) || statusData.ok !== true) {
    return patientConsentError(patientConsentRpcCode(statusData, statusError));
  }
  const statusPatientId = readStringField(statusData, "patientId", "patient_id");
  if (statusPatientId !== patientId) return patientConsentError("not_found");

  const { data, error } = await supabase.rpc("cancel_patient_consent_session", {
    target_session: sessionId,
  });
  if (error || !isJsonObject(data) || data.ok !== true) {
    return patientConsentError(patientConsentRpcCode(data, error));
  }

  return patientConsentJson({ ok: true, code: "cancelled", sessionId, status: "cancelled" });
}
