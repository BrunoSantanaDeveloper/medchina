type RecordingRequestStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const requestKey = (consultationId: string) => `medchina.web-recording-request.v1:${consultationId}`;

/**
 * Persist the idempotency key before the begin RPC. The same key survives a
 * component remount or a response lost after the server committed.
 */
export function getOrCreateWebRecordingRequest(
  storage: RecordingRequestStorage,
  consultationId: string,
  createId: () => string,
): string {
  try {
    const existing = storage.getItem(requestKey(consultationId));
    if (existing) return existing;
  } catch {
    // Fall back to the component's in-memory ref when storage is unavailable.
  }

  const created = createId();
  try {
    storage.setItem(requestKey(consultationId), created);
  } catch {
    // The caller still receives the key and retains it in memory.
  }
  return created;
}

export function clearWebRecordingRequest(storage: RecordingRequestStorage, consultationId: string): void {
  try {
    storage.removeItem(requestKey(consultationId));
  } catch {
    // Best effort; a matching durable row remains idempotent on the server.
  }
}
