import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransition,
  deriveConsultationCapabilities,
  deriveConsultationExperience,
  deriveConsultationState,
  getConsultationCapabilities,
  remoteError,
  remoteEmpty,
  remoteLoading,
  remoteSuccess,
  sanitizeInternalNext,
} from "./index.ts";

test("consultation transitions keep terminal records terminal", () => {
  assert.equal(canTransition("scheduled", "in_progress"), true);
  assert.equal(canTransition("draft", "finalized"), true);
  assert.equal(canTransition("finalized", "draft"), false);
  assert.equal(canTransition("cancelled", "scheduled"), false);
  assert.equal(canTransition("cancelled", "scheduled", { canRestoreCancelledAppointment: true }), true);
});

test("recording operation takes precedence over consultation status", () => {
  assert.equal(
    deriveConsultationExperience({ consultationStatus: "awaiting_review", recordingStatus: "uploading" }),
    "uploading",
  );
  assert.equal(
    deriveConsultationExperience({ consultationStatus: "in_progress", recordingStatus: "failed" }),
    "failed",
  );
  assert.equal(
    deriveConsultationExperience({ consultationStatus: "finalized", recordingStatus: "failed" }),
    "finalized",
  );
});

test("canonical state considers every recording and preserves terminal consultations", () => {
  assert.equal(
    deriveConsultationState({ status: "awaiting_review" }, [{ status: "ready" }, { status: "uploading" }]),
    "uploading",
  );
  assert.equal(deriveConsultationState({ status: "finalized" }, [{ status: "failed" }]), "finalized");
  assert.equal(getConsultationCapabilities("processing").canFinalize, false);
});

test("pending audio blocks new capture and finalization", () => {
  const capabilities = deriveConsultationCapabilities({
    consultationStatus: "awaiting_review",
    recordingStatus: "processing",
    hasValidatedPlan: true,
  });
  assert.equal(capabilities.canRecord, false);
  assert.equal(capabilities.canFinalize, false);
  assert.equal(capabilities.canIssueValidatedDocument, true);
});

test("finalized records allow addenda and validated document issuance only", () => {
  const capabilities = deriveConsultationCapabilities({
    consultationStatus: "finalized",
    recordingStatus: "ready",
    hasValidatedPlan: true,
  });
  assert.equal(capabilities.canEditClinicalRecord, false);
  assert.equal(capabilities.canAddAddendum, true);
  assert.equal(capabilities.canIssueValidatedDocument, true);
});

test("remote state constructors retain optional previous data", () => {
  assert.deepEqual(remoteLoading("cached"), { status: "loading", previous: "cached" });
  assert.deepEqual(remoteSuccess(3), { status: "success", data: 3 });
  assert.deepEqual(remoteEmpty(), { status: "empty" });
  assert.deepEqual(remoteError("failed", 2), { status: "error", error: "failed", previous: 2 });
});

test("sanitizeInternalNext accepts only same-origin absolute paths", () => {
  assert.equal(sanitizeInternalNext("/consultas/abc?tab=plano#top"), "/consultas/abc?tab=plano#top");
  assert.equal(sanitizeInternalNext("https://evil.example"), "/inicio");
  assert.equal(sanitizeInternalNext("//evil.example/path"), "/inicio");
  assert.equal(sanitizeInternalNext("/%2F%2Fevil.example"), "/inicio");
  assert.equal(sanitizeInternalNext("/\\evil.example"), "/inicio");
  assert.equal(sanitizeInternalNext("javascript:alert(1)", "/pacientes"), "/pacientes");
  assert.equal(sanitizeInternalNext(null, "https://evil.example"), "/inicio");
});
