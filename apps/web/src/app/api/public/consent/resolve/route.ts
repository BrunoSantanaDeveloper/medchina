import { patientConsentError, patientConsentJson, patientConsentRpcCode } from "@/lib/patient-consent-route";
import {
  hashPatientConsentToken,
  hasJsonContentType,
  hasOnlyKeys,
  hasSameOrigin,
  isJsonObject,
  isPatientConsentToken,
  PATIENT_CONSENT_SLUGS,
  readBoundedJsonObject,
  readStringField,
} from "@/lib/patient-consent-session";
import { createServiceClient } from "@flyee/auth/service";

type PublicConsentTerm = {
  slug: (typeof PATIENT_CONSENT_SLUGS)[number];
  version: number;
  title: string;
  body: string;
};

function normalizeTerms(value: unknown): PublicConsentTerm[] | null {
  if (!Array.isArray(value) || value.length !== PATIENT_CONSENT_SLUGS.length) return null;

  const terms = value.flatMap((entry): PublicConsentTerm[] => {
    if (!isJsonObject(entry)) return [];
    const slug = readStringField(entry, "slug");
    const title = readStringField(entry, "title");
    const body = readStringField(entry, "body");
    const version = entry.version;
    if (
      !PATIENT_CONSENT_SLUGS.includes(slug as (typeof PATIENT_CONSENT_SLUGS)[number]) ||
      !title ||
      !body ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      return [];
    }
    return [{ slug: slug as PublicConsentTerm["slug"], version, title, body }];
  });

  if (terms.length !== PATIENT_CONSENT_SLUGS.length) return null;
  if (new Set(terms.map((term) => term.slug)).size !== PATIENT_CONSENT_SLUGS.length) return null;
  return PATIENT_CONSENT_SLUGS.map((slug) => terms.find((term) => term.slug === slug) as PublicConsentTerm);
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return patientConsentError("not_authorized");
  if (!hasJsonContentType(request)) return patientConsentError("invalid_request", 415);

  const body = await readBoundedJsonObject(request);
  if (!body || !hasOnlyKeys(body, ["token"])) return patientConsentError("invalid_request");
  if (!isPatientConsentToken(body.token)) return patientConsentError("consent_link_invalid");

  let service;
  try {
    service = createServiceClient();
  } catch {
    return patientConsentError("internal_error");
  }

  const { data, error } = await service.rpc("resolve_patient_consent_session", {
    target_token_hash: hashPatientConsentToken(body.token),
  });
  if (error || !isJsonObject(data) || data.ok !== true) {
    return patientConsentError(patientConsentRpcCode(data, error));
  }

  if (readStringField(data, "status") === "completed") {
    const completedAt = readStringField(data, "completedAt", "completed_at");
    return patientConsentJson({
      ok: true,
      status: "completed",
      ...(completedAt ? { completedAt } : {}),
    });
  }

  const termSource = data.terms ?? data.termsSnapshot ?? data.terms_snapshot;
  const terms = normalizeTerms(termSource);
  const expiresAt = readStringField(data, "expiresAt", "expires_at");
  if (!terms || !expiresAt) return patientConsentError("internal_error");

  const organizationName = readStringField(data, "organizationName", "practiceName", "practice_name", "orgName");
  const affirmationVersion = data.affirmationVersion;

  return patientConsentJson({
    ok: true,
    status: "pending",
    expiresAt,
    terms,
    ...(typeof affirmationVersion === "number" && Number.isInteger(affirmationVersion) && affirmationVersion > 0
      ? { affirmationVersion }
      : {}),
    ...(organizationName ? { organizationName } : {}),
  });
}
