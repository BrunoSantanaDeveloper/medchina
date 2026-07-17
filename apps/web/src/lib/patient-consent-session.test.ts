import {
  createPatientConsentToken,
  hasJsonContentType,
  hasSameOrigin,
  isPatientConsentToken,
  isUuid,
  parsePatientConsentDecisions,
  parseSignerRole,
  readBoundedJsonObject,
} from "./patient-consent-session";
import { describe, expect, it } from "vitest";

describe("patient consent session boundaries", () => {
  it("creates a 256-bit base64url capability and stores a SHA-256 digest", () => {
    const first = createPatientConsentToken();
    const second = createPatientConsentToken();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.tokenHash).not.toContain(first.token);
    expect(second.token).not.toBe(first.token);
    expect(second.tokenHash).not.toBe(first.tokenHash);
    expect(isPatientConsentToken(first.token)).toBe(true);
    expect(isPatientConsentToken(`${first.token}=`)).toBe(false);
  });

  it("requires one explicit boolean decision for each independent purpose", () => {
    const decisions = {
      "audio-recording": true,
      "ai-processing": true,
      "clinical-images": false,
    };

    expect(parsePatientConsentDecisions(decisions)).toEqual(decisions);
    expect(parsePatientConsentDecisions({ ...decisions, extra: true })).toBeNull();
    expect(parsePatientConsentDecisions({ "audio-recording": true, "ai-processing": true })).toBeNull();
    expect(parsePatientConsentDecisions({ ...decisions, "clinical-images": "yes" })).toBeNull();
  });

  it("accepts only supported signer roles and canonical UUIDs", () => {
    expect(parseSignerRole("patient")).toBe("patient");
    expect(parseSignerRole("legal_representative")).toBe("legal_representative");
    expect(parseSignerRole("professional")).toBeNull();
    expect(isUuid("10000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("../patient")).toBe(false);
  });

  it("requires JSON and the exact request origin for browser mutations", () => {
    const valid = new Request("https://app.example/api/public/consent/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Origin: "https://app.example" },
      body: "{}",
    });
    const foreign = new Request("https://app.example/api/public/consent/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: "{}",
    });

    expect(hasJsonContentType(valid)).toBe(true);
    expect(hasSameOrigin(valid)).toBe(true);
    expect(hasSameOrigin(foreign)).toBe(false);
  });

  it("rejects malformed and oversized JSON before domain parsing", async () => {
    const malformed = new Request("https://app.example/api", {
      method: "POST",
      body: "{",
    });
    const oversized = new Request("https://app.example/api", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(100) }),
    });

    await expect(readBoundedJsonObject(malformed)).resolves.toBeNull();
    await expect(readBoundedJsonObject(oversized, 32)).resolves.toBeNull();
  });
});
