import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyAiError,
  clinicalProviderCode,
  describeAiFailure,
  StructuredOutputError,
  structuredFailureFromGemini,
} from "./errors.ts";

test("a Gemini reply cut at the token cap is truncated, not invalid JSON", () => {
  assert.deepEqual(
    structuredFailureFromGemini({ text: '{"hypotheses":[{"pattern":"Defic', candidates: [{ finishReason: "MAX_TOKENS" }] }),
    { failure: "truncated", finishReason: "MAX_TOKENS" },
  );
});

test("a provider refusal is blocked, from either the candidate or the prompt feedback", () => {
  assert.deepEqual(structuredFailureFromGemini({ text: "", candidates: [{ finishReason: "SAFETY" }] }), {
    failure: "blocked",
    finishReason: "SAFETY",
  });
  assert.deepEqual(structuredFailureFromGemini({ text: "{}", promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }), {
    failure: "blocked",
    finishReason: "PROHIBITED_CONTENT",
  });
});

test("an empty or blank reply is reported as empty, and a usable one passes through", () => {
  assert.deepEqual(structuredFailureFromGemini({ text: "   ", candidates: [{ finishReason: "STOP" }] }), {
    failure: "empty",
    finishReason: "STOP",
  });
  assert.equal(structuredFailureFromGemini({ text: '{"ok":true}', candidates: [{ finishReason: "STOP" }] }), null);
  // A response with no candidates array at all must not crash.
  assert.deepEqual(structuredFailureFromGemini({}), { failure: "empty", finishReason: undefined });
});

test("transient failures are told apart from definitive ones", () => {
  assert.equal(classifyAiError({ status: 503 }).transient, true);
  assert.equal(classifyAiError({ status: 429, message: "rate limit" }).transient, true);
  assert.equal(classifyAiError(new Error("quota: credits are depleted")).transient, true, "no status means retry");
  assert.equal(
    classifyAiError(Object.assign(new Error("credits are depleted"), { status: 429 })).transient,
    false,
    "a billing 429 is not a rate limit",
  );
  assert.equal(classifyAiError({ status: 401 }).transient, false);
  assert.equal(classifyAiError({ status: 404 }).transient, false);
  assert.equal(classifyAiError(new Error("network aborted")).transient, true);
});

test("the status is read from the message when the SDK does not expose it", () => {
  assert.equal(classifyAiError(new Error("OpenAI request failed (401): bad key")).status, 401);
  assert.equal(classifyAiError(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}')).status, 503);
});

test("a truncated answer is retryable while a refusal is not", () => {
  const truncated = new StructuredOutputError({ failure: "truncated", provider: "gemini", finishReason: "MAX_TOKENS" });
  const blocked = new StructuredOutputError({ failure: "blocked", provider: "gemini", finishReason: "SAFETY" });
  assert.equal(clinicalProviderCode(truncated), "provider_unavailable");
  assert.equal(clinicalProviderCode(blocked), "provider_rejected");
  assert.equal(clinicalProviderCode({ status: 500 }), "provider_unavailable");
  assert.equal(clinicalProviderCode({ status: 403 }), "provider_rejected");
});

test("the log description never carries model output", () => {
  const error = new StructuredOutputError({
    failure: "invalid_json",
    provider: "gemini",
    finishReason: "STOP",
    detail: "1234 characters returned",
  });
  const described = describeAiFailure(error);
  assert.equal(described.failure, "invalid_json");
  assert.equal(described.provider, "gemini");
  assert.equal(described.message, undefined, "the message would quote the patient's record");
  assert.equal(String(describeAiFailure(new Error("x".repeat(500))).message).length, 300);
});
