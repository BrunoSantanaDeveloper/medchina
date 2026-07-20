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

export type RecordingMode = "ai" | "audio_only";

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

export function canRetryQueueItem(state: QueueState): boolean {
  return state === "local" || state === "failed" || state === "blocked";
}

/** Audio is on the phone and still moving on its own — nothing for her to do. */
export function isAwaitingDelivery(state: QueueState): boolean {
  return state === "local" || state === "authorizing" || state === "uploading";
}

/** Audio is on the phone and stopped. Only these states deserve her attention. */
export function needsAttention(state: QueueState): boolean {
  return state === "failed" || state === "blocked" || state === "quarantined";
}

export const DELIVERED_RETENTION_DAYS = 7;

/**
 * `uploaded` is terminal only for `audio_only`. An AI capture still owes its
 * processing dispatch, so its row must survive until the server is processing.
 */
export function isDeliveredTerminal(state: QueueState, mode: RecordingMode): boolean {
  if (state === "ready") return true;
  return state === "uploaded" && mode === "audio_only";
}

/**
 * A delivered row is kept for a while so the day's history stays readable, then
 * purged. Anything still holding audio (`failed`/`blocked`/`quarantined`) is
 * NEVER purged automatically — that audio is only hers to discard.
 */
export function shouldPurgeDeliveredItem(
  item: { state: QueueState; mode: RecordingMode; updatedAt: string },
  now = Date.now(),
): boolean {
  if (!isDeliveredTerminal(item.state, item.mode)) return false;
  const updated = new Date(item.updatedAt).getTime();
  if (!Number.isFinite(updated)) return false;
  return now - updated >= DELIVERED_RETENTION_DAYS * 86_400_000;
}
