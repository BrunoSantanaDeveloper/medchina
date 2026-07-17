import { patientConsentError, patientConsentJson, patientConsentRpcCode } from "@/lib/patient-consent-route";
import {
  hashPatientConsentToken,
  hasJsonContentType,
  hasOnlyKeys,
  hasSameOrigin,
  isJsonObject,
  isPatientConsentToken,
  isUuid,
  parseBoundedText,
  parsePatientConsentDecisions,
  parseSignerRole,
  readBoundedJsonObject,
  readStringField,
} from "@/lib/patient-consent-session";
import { createServiceClient } from "@flyee/auth/service";

const BODY_KEYS = [
  "token",
  "decisions",
  "idempotencyKey",
  "signerRole",
  "signerName",
  "representativeRelationship",
  "confirmed",
] as const;

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return patientConsentError("not_authorized");
  if (!hasJsonContentType(request)) return patientConsentError("invalid_request", 415);

  const body = await readBoundedJsonObject(request);
  if (!body || !hasOnlyKeys(body, BODY_KEYS)) return patientConsentError("invalid_request");
  if (!isPatientConsentToken(body.token)) return patientConsentError("consent_link_invalid");
  if (!isUuid(body.idempotencyKey) || body.confirmed !== true) return patientConsentError("invalid_request");

  const decisions = parsePatientConsentDecisions(body.decisions);
  const signerRole = parseSignerRole(body.signerRole);
  const signerName = parseBoundedText(body.signerName, 160);
  if (!decisions || !signerRole || !signerName) return patientConsentError("invalid_request");

  const representativeRelationship =
    signerRole === "legal_representative" ? parseBoundedText(body.representativeRelationship, 120) : null;
  if (signerRole === "legal_representative" && !representativeRelationship) {
    return patientConsentError("invalid_request");
  }

  let service;
  try {
    service = createServiceClient();
  } catch {
    return patientConsentError("internal_error");
  }

  const { data, error } = await service.rpc("submit_patient_consent_session", {
    target_token_hash: hashPatientConsentToken(body.token),
    target_decisions: decisions,
    target_idempotency_key: body.idempotencyKey,
    target_signer_role: signerRole,
    target_signer_name: signerName,
    target_representative_relationship: representativeRelationship,
    target_confirmed: true,
  });
  if (error || !isJsonObject(data) || data.ok !== true) {
    return patientConsentError(patientConsentRpcCode(data, error));
  }

  const completedAt = readStringField(data, "completedAt", "completed_at");
  return patientConsentJson({
    ok: true,
    code: "submitted",
    status: "completed",
    ...(completedAt ? { completedAt } : {}),
  });
}
