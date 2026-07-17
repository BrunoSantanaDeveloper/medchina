import {
  canRetryQueueItem,
  isDeliveredRecordingStatus,
  isProcessingDispatchAccepted,
  recoverQueueState,
  shouldRetainLocalAudio,
} from "./recording-state";

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
});
