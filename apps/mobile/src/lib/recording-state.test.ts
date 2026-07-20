import {
  canRetryQueueItem,
  isAwaitingDelivery,
  isDeliveredRecordingStatus,
  isDeliveredTerminal,
  isProcessingDispatchAccepted,
  needsAttention,
  recoverQueueState,
  shouldPurgeDeliveredItem,
  shouldRetainLocalAudio,
  QUEUE_STATES,
} from "./recording-state";

const DAY = 86_400_000;

describe("recording queue state", () => {
  it("recovers an expired upload lease without losing the item", () => {
    expect(recoverQueueState("uploading", 99, 100)).toBe("local");
    expect(recoverQueueState("uploading", 101, 100)).toBe("uploading");
  });

  it("keeps encrypted audio until the server accepted it", () => {
    expect(shouldRetainLocalAudio("local")).toBe(true);
    expect(shouldRetainLocalAudio("failed")).toBe(true);
    expect(shouldRetainLocalAudio("uploaded")).toBe(true);
    expect(shouldRetainLocalAudio("processing")).toBe(false);
    expect(shouldRetainLocalAudio("ready")).toBe(false);
  });

  it("accepts only explicit idempotent processing conflicts", () => {
    expect(isProcessingDispatchAccepted(true, 202)).toBe(true);
    expect(isProcessingDispatchAccepted(false, 409, "processing_already_claimed")).toBe(true);
    expect(isProcessingDispatchAccepted(false, 409, "ready")).toBe(true);
    expect(isProcessingDispatchAccepted(false, 409, "clinical_revision_conflict")).toBe(false);
    expect(isProcessingDispatchAccepted(false, 409)).toBe(false);
  });

  it("recognizes only server-owned delivery states", () => {
    expect(isDeliveredRecordingStatus("uploaded")).toBe(true);
    expect(isDeliveredRecordingStatus("processing")).toBe(true);
    expect(isDeliveredRecordingStatus("ready")).toBe(true);
    expect(isDeliveredRecordingStatus("cancelled")).toBe(false);
  });

  it("only offers retries for recoverable states", () => {
    expect(canRetryQueueItem("blocked")).toBe(true);
    expect(canRetryQueueItem("failed")).toBe(true);
    expect(canRetryQueueItem("processing")).toBe(false);
  });

  // The home banner says "waiting to be sent". A delivered recording that keeps
  // counting there would be a standing lie about audio still on the phone.
  it("counts as awaiting delivery only what is still on the phone and moving", () => {
    expect(isAwaitingDelivery("local")).toBe(true);
    expect(isAwaitingDelivery("authorizing")).toBe(true);
    expect(isAwaitingDelivery("uploading")).toBe(true);
    expect(isAwaitingDelivery("uploaded")).toBe(false);
    expect(isAwaitingDelivery("processing")).toBe(false);
    expect(isAwaitingDelivery("ready")).toBe(false);
    expect(isAwaitingDelivery("failed")).toBe(false);
  });

  it("asks for attention only where she must decide something", () => {
    expect(needsAttention("failed")).toBe(true);
    expect(needsAttention("blocked")).toBe(true);
    expect(needsAttention("quarantined")).toBe(true);
    expect(needsAttention("local")).toBe(false);
    expect(needsAttention("ready")).toBe(false);
  });

  it("splits every state into exactly one of awaiting, attention or delivered", () => {
    for (const state of QUEUE_STATES) {
      const buckets = [
        isAwaitingDelivery(state),
        needsAttention(state),
        ["uploaded", "processing", "ready"].includes(state),
      ].filter(Boolean);
      expect(buckets).toHaveLength(1);
    }
  });

  it("treats uploaded as terminal only when no processing is owed", () => {
    expect(isDeliveredTerminal("uploaded", "audio_only")).toBe(true);
    expect(isDeliveredTerminal("uploaded", "ai")).toBe(false);
    expect(isDeliveredTerminal("ready", "ai")).toBe(true);
    expect(isDeliveredTerminal("processing", "ai")).toBe(false);
  });

  it("purges delivered rows after the retention window and nothing else", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    const old = new Date(now - 8 * DAY).toISOString();
    const recent = new Date(now - 1 * DAY).toISOString();

    expect(shouldPurgeDeliveredItem({ state: "ready", mode: "ai", updatedAt: old }, now)).toBe(true);
    expect(shouldPurgeDeliveredItem({ state: "ready", mode: "ai", updatedAt: recent }, now)).toBe(false);
    // An AI capture that only reached `uploaded` still owes its dispatch.
    expect(shouldPurgeDeliveredItem({ state: "uploaded", mode: "ai", updatedAt: old }, now)).toBe(false);
    expect(shouldPurgeDeliveredItem({ state: "uploaded", mode: "audio_only", updatedAt: old }, now)).toBe(true);
    // Audio she still owns is never dropped on a timer, however old.
    expect(shouldPurgeDeliveredItem({ state: "failed", mode: "ai", updatedAt: old }, now)).toBe(false);
    expect(shouldPurgeDeliveredItem({ state: "quarantined", mode: "ai", updatedAt: old }, now)).toBe(false);
    expect(shouldPurgeDeliveredItem({ state: "ready", mode: "ai", updatedAt: "not-a-date" }, now)).toBe(false);
  });
});
