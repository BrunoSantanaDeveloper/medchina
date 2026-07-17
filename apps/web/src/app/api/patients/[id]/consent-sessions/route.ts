import { createClinicalRequestClient } from "@/lib/clinical-route";
import { patientConsentError, patientConsentJson, patientConsentRpcCode } from "@/lib/patient-consent-route";
import {
  createPatientConsentToken,
  createRequestId,
  hasJsonContentType,
  hasOnlyKeys,
  hasSameOrigin,
  isJsonObject,
  isUuid,
  readBoundedJsonObject,
  readStringField,
} from "@/lib/patient-consent-session";

const BODY_KEYS = ["consultationId", "requestId"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSameOrigin(request)) return patientConsentError("not_authorized");
  if (!hasJsonContentType(request)) return patientConsentError("invalid_request", 415);

  const { id: patientId } = await params;
  if (!isUuid(patientId)) return patientConsentError("invalid_request");

  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return patientConsentError("not_authenticated");

  const body = await readBoundedJsonObject(request);
  if (!body || !hasOnlyKeys(body, BODY_KEYS)) return patientConsentError("invalid_request");

  const consultationId = body.consultationId === undefined || body.consultationId === null ? null : body.consultationId;
  if (consultationId !== null && !isUuid(consultationId)) return patientConsentError("invalid_request");

  const requestId = body.requestId === undefined ? createRequestId() : body.requestId;
  if (!isUuid(requestId)) return patientConsentError("invalid_request");

  const { token, tokenHash } = createPatientConsentToken();
  const { data, error } = await supabase.rpc("create_patient_consent_session", {
    target_patient: patientId,
    target_token_hash: tokenHash,
    target_request_id: requestId,
    target_consultation: consultationId,
  });

  if (error || !isJsonObject(data) || data.ok !== true) {
    return patientConsentError(patientConsentRpcCode(data, error));
  }

  const sessionId = readStringField(data, "sessionId", "session_id");
  const expiresAt = readStringField(data, "expiresAt", "expires_at");
  if (!isUuid(sessionId) || !expiresAt) return patientConsentError("internal_error");

  return patientConsentJson(
    {
      ok: true,
      code: "created",
      sessionId,
      requestId,
      token,
      status: "pending",
      expiresAt,
    },
    201,
  );
}
