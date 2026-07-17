export const QUEUE_STATES = [
  "local",
  "authorizing",
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "blocked",
  "quarantined",
] as const;

export type QueueState = (typeof QUEUE_STATES)[number];

export function recoverQueueState(state: QueueState, leaseUntil: number | null, now = Date.now()): QueueState {
  if ((state === "authorizing" || state === "uploading") && (!leaseUntil || leaseUntil <= now)) return "local";
  return state;
}

export function shouldRetainLocalAudio(state: QueueState): boolean {
  // `uploaded` still means the processing request may not have crossed the
  // network boundary. Keep the encrypted source until the server is known to
  // be processing (or the recording is ready).
  return !["processing", "ready"].includes(state);
}

export type DeliveredRecordingStatus = "uploaded" | "processing" | "ready";

export function isDeliveredRecordingStatus(value: unknown): value is DeliveredRecordingStatus {
  return value === "uploaded" || value === "processing" || value === "ready";
}

export function isProcessingDispatchAccepted(responseOk: boolean, httpStatus: number, code?: string): boolean {
  if (responseOk) return true;
  return httpStatus === 409 && (code === "processing_already_claimed" || code === "ready");
}

export function isQueueTerminal(state: QueueState): boolean {
  return state === "ready" || state === "quarantined";
}

export function canRetryQueueItem(state: QueueState): boolean {
  return state === "local" || state === "failed" || state === "blocked";
}
