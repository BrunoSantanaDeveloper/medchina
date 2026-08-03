/**
 * Local durability for the phone capture page (`/gravar`).
 *
 * Mobile browsers kill tabs aggressively (app switch, memory pressure, an
 * accidental reload) and the QR capture used to hold its audio chunks only in
 * memory — a consultation's audio has no second take, so every captured chunk
 * is persisted to IndexedDB as it arrives and cleared only after the server
 * confirms the upload. On reload, pending chunks are offered back as a
 * recoverable upload (the recording row is idempotent on clientUploadId, so a
 * fresh QR for the SAME consultation can still deliver them).
 *
 * Kept dependency-free and tiny on purpose: this runs on a patient-facing
 * public page that must load fast on a weak connection.
 */

const DB_NAME = "medchina-mobile-capture";
const DB_VERSION = 1;
const CHUNKS = "chunks";
const META = "meta";

type CaptureMeta = { uploadId: string; mime: string; updatedAt: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const store = db.createObjectStore(CHUNKS, { autoIncrement: true });
        store.createIndex("uploadId", "uploadId", { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "uploadId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_unavailable"));
  });
}

function requestDone(request: IDBRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("indexeddb_write_failed"));
  });
}

async function withStore<T>(
  names: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(names, mode);
    return await run(tx);
  } finally {
    db.close();
  }
}

/** Ask the browser not to evict this origin's storage under disk pressure. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Best effort only.
  }
}

export async function beginCaptureStore(uploadId: string, mime: string): Promise<void> {
  await withStore([META], "readwrite", async (tx) => {
    const meta: CaptureMeta = { uploadId, mime, updatedAt: Date.now() };
    await requestDone(tx.objectStore(META).put(meta));
  });
}

export async function appendCaptureChunk(uploadId: string, blob: Blob): Promise<void> {
  await withStore([CHUNKS], "readwrite", async (tx) => {
    await requestDone(tx.objectStore(CHUNKS).add({ uploadId, blob, at: Date.now() }));
  });
}

export type RecoveredCapture = { blob: Blob; mime: string; approxSeconds: number };

/**
 * Rebuild an unsent capture. `approxSeconds` counts 1s MediaRecorder
 * timeslices — an honest floor for the duration the phone lost track of.
 */
export async function recoverCapture(uploadId: string): Promise<RecoveredCapture | null> {
  try {
    return await withStore([CHUNKS, META], "readonly", async (tx) => {
      const meta = await new Promise<CaptureMeta | null>((resolve, reject) => {
        const request = tx.objectStore(META).get(uploadId);
        request.onsuccess = () => resolve((request.result as CaptureMeta | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error("indexeddb_read_failed"));
      });
      const chunks = await new Promise<Blob[]>((resolve, reject) => {
        const request = tx.objectStore(CHUNKS).index("uploadId").getAll(uploadId);
        request.onsuccess = () => resolve(((request.result ?? []) as { blob: Blob }[]).map((entry) => entry.blob));
        request.onerror = () => reject(request.error ?? new Error("indexeddb_read_failed"));
      });
      if (!meta || chunks.length === 0) return null;
      return {
        blob: new Blob(chunks, { type: meta.mime }),
        mime: meta.mime,
        approxSeconds: chunks.length,
      };
    });
  } catch {
    return null;
  }
}

export async function clearCapture(uploadId: string): Promise<void> {
  try {
    await withStore([CHUNKS, META], "readwrite", async (tx) => {
      await requestDone(tx.objectStore(META).delete(uploadId));
      await new Promise<void>((resolve, reject) => {
        const cursorRequest = tx.objectStore(CHUNKS).index("uploadId").openCursor(uploadId);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return resolve();
          cursor.delete();
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("indexeddb_write_failed"));
      });
    });
  } catch {
    // Losing the cleanup only leaves stale bytes; never block the flow on it.
  }
}
