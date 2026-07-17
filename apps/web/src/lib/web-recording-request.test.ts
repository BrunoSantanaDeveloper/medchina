import { clearWebRecordingRequest, getOrCreateWebRecordingRequest } from "./web-recording-request";
import { describe, expect, it, vi } from "vitest";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("web recording request idempotency", () => {
  it("reuses the same key after an ambiguous response loss", () => {
    const storage = memoryStorage();
    const createId = vi.fn().mockReturnValueOnce("request-1").mockReturnValueOnce("request-2");

    expect(getOrCreateWebRecordingRequest(storage, "consultation-1", createId)).toBe("request-1");
    expect(getOrCreateWebRecordingRequest(storage, "consultation-1", createId)).toBe("request-1");
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("creates a new key only after the durable handoff consumes the prior one", () => {
    const storage = memoryStorage();
    const createId = vi.fn().mockReturnValueOnce("request-1").mockReturnValueOnce("request-2");

    expect(getOrCreateWebRecordingRequest(storage, "consultation-1", createId)).toBe("request-1");
    clearWebRecordingRequest(storage, "consultation-1");
    expect(getOrCreateWebRecordingRequest(storage, "consultation-1", createId)).toBe("request-2");
  });
});
