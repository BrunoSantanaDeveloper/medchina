import { bytesToHex } from "@noble/ciphers/utils";
import { sha256 } from "@noble/hashes/sha256";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { decryptBytes, decryptJson, encryptBytes, encryptJson } from "@/lib/recording-crypto";
import { recoverQueueState, type QueueState } from "@/lib/recording-state";

export type { QueueState } from "@/lib/recording-state";

export const RECORDING_CHUNK_BYTES = 6 * 1024 * 1024;
export const MAX_RECORDING_BYTES = 512 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 120 * 60;

export type RecordingMode = "ai" | "audio_only";

export type QueuePayload = {
  consultationId: string;
  orgId: string;
  patientId: string;
  durationSeconds: number;
  sizeBytes: number;
  checksumSha256: string;
  chunkCount: number;
  mime: string;
  mode: RecordingMode;
  clientUploadId: string;
  recordingId?: string;
  authorizationId?: string;
  authorizationExpiresAt?: string;
};

export type QueueItem = QueuePayload & {
  id: string;
  state: QueueState;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  progress: number;
  errorCode?: string;
  /** Payload cannot be read or one of the encrypted chunks is missing. */
  quarantined?: boolean;
};

type QueueRow = {
  id: string;
  state: QueueState;
  payload_ciphertext: string;
  created_at: string;
  updated_at: string;
  attempts: number;
  progress: number;
  error_code: string | null;
  lease_until: number | null;
};

type TusRow = { key: string; payload_ciphertext: string };

const DB_NAME = "medchina-capture.db";
const AUDIO_DIR = "recording-chunks-v1";
const EMPTY_PAYLOAD: QueuePayload = {
  consultationId: "",
  orgId: "",
  patientId: "",
  durationSeconds: 0,
  sizeBytes: 0,
  checksumSha256: "",
  chunkCount: 0,
  mime: "audio/m4a",
  mode: "ai",
  clientUploadId: "",
};

let databasePromise: Promise<SQLiteDatabase> | null = null;

async function database(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS recording_queue (
          id TEXT PRIMARY KEY NOT NULL,
          state TEXT NOT NULL,
          payload_ciphertext TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          progress REAL NOT NULL DEFAULT 0,
          error_code TEXT,
          lease_until INTEGER
        );
        CREATE INDEX IF NOT EXISTS recording_queue_state_idx ON recording_queue(state, created_at);
        CREATE TABLE IF NOT EXISTS tus_uploads (
          key TEXT PRIMARY KEY NOT NULL,
          fingerprint_hash TEXT NOT NULL,
          payload_ciphertext TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS tus_uploads_fingerprint_idx ON tus_uploads(fingerprint_hash);
      `);
      return db;
    });
  }
  return databasePromise;
}

const itemDirectory = (id: string) => new Directory(Paths.document, AUDIO_DIR, id);
const chunkFile = (id: string, index: number) => new File(itemDirectory(id), `${String(index).padStart(6, "0")}.chunk`);

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function rowToItem(row: QueueRow, payload: QueuePayload, state = row.state): QueueItem {
  return {
    id: row.id,
    state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attempts: row.attempts,
    progress: row.progress,
    errorCode: row.error_code ?? undefined,
    ...payload,
  };
}

async function decodeRow(row: QueueRow): Promise<QueueItem> {
  const state = recoverQueueState(row.state, row.lease_until);
  if (state !== row.state) {
    const db = await database();
    await db.runAsync(
      "UPDATE recording_queue SET state = ?, lease_until = NULL, updated_at = ? WHERE id = ?",
      state,
      new Date().toISOString(),
      row.id,
    );
  }
  try {
    const payload = await decryptJson<QueuePayload>(row.payload_ciphertext, `queue:${row.id}`);
    return rowToItem(row, payload, state);
  } catch {
    await quarantineQueueItem(row.id, "metadata_corrupt");
    return {
      ...rowToItem(row, EMPTY_PAYLOAD, "quarantined"),
      errorCode: "metadata_corrupt",
      quarantined: true,
    };
  }
}

export async function readQueue(): Promise<QueueItem[]> {
  const db = await database();
  const rows = await db.getAllAsync<QueueRow>("SELECT * FROM recording_queue ORDER BY created_at ASC");
  return Promise.all(rows.map(decodeRow));
}

export async function queueForConsultation(consultationId: string): Promise<QueueItem[]> {
  return (await readQueue()).filter((item) => item.consultationId === consultationId);
}

export async function getQueueItem(id: string): Promise<QueueItem | null> {
  const db = await database();
  const row = await db.getFirstAsync<QueueRow>("SELECT * FROM recording_queue WHERE id = ?", id);
  return row ? decodeRow(row) : null;
}

export async function updateQueueItem(
  id: string,
  input: {
    state?: QueueState;
    payload?: Partial<QueuePayload>;
    progress?: number;
    errorCode?: string | null;
    leaseUntil?: number | null;
    incrementAttempts?: boolean;
  },
): Promise<QueueItem | null> {
  const db = await database();
  let result: QueueItem | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<QueueRow>("SELECT * FROM recording_queue WHERE id = ?", id);
    if (!row) return;
    const current = await decryptJson<QueuePayload>(row.payload_ciphertext, `queue:${id}`);
    const payload = { ...current, ...input.payload };
    const encrypted = await encryptJson(payload, `queue:${id}`);
    const now = new Date().toISOString();
    await tx.runAsync(
      `UPDATE recording_queue
       SET state = ?, payload_ciphertext = ?, updated_at = ?, attempts = attempts + ?,
           progress = ?, error_code = ?, lease_until = ?
       WHERE id = ?`,
      input.state ?? row.state,
      encrypted,
      now,
      input.incrementAttempts ? 1 : 0,
      input.progress ?? row.progress,
      input.errorCode === undefined ? row.error_code : input.errorCode,
      input.leaseUntil === undefined ? row.lease_until : input.leaseUntil,
      id,
    );
    result = {
      ...rowToItem(row, payload, input.state ?? row.state),
      updatedAt: now,
      attempts: row.attempts + (input.incrementAttempts ? 1 : 0),
      progress: input.progress ?? row.progress,
      errorCode: input.errorCode === undefined ? (row.error_code ?? undefined) : (input.errorCode ?? undefined),
    };
  });
  return result;
}

export async function quarantineQueueItem(id: string, errorCode: string): Promise<void> {
  const db = await database();
  await db.runAsync(
    "UPDATE recording_queue SET state = 'quarantined', error_code = ?, lease_until = NULL, updated_at = ? WHERE id = ?",
    errorCode,
    new Date().toISOString(),
    id,
  );
}

export async function acquireUploadLease(id: string, leaseMs = 5 * 60_000): Promise<boolean> {
  const db = await database();
  let acquired = false;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<QueueRow>("SELECT * FROM recording_queue WHERE id = ?", id);
    if (!row) return;
    const recovered = recoverQueueState(row.state, row.lease_until);
    if (!["local", "failed", "blocked"].includes(recovered)) return;
    const now = new Date().toISOString();
    await tx.runAsync(
      `UPDATE recording_queue
       SET state = 'uploading', lease_until = ?, attempts = attempts + 1,
           error_code = NULL, updated_at = ? WHERE id = ?`,
      Date.now() + leaseMs,
      now,
      id,
    );
    acquired = true;
  });
  return acquired;
}

export class RecordingLimitError extends Error {
  constructor(readonly code: "recording_too_long" | "recording_too_large") {
    super(code);
  }
}

export async function persistEncryptedRecording(input: {
  sourceUri: string;
  consultationId: string;
  orgId: string;
  patientId: string;
  durationSeconds: number;
  mode: RecordingMode;
  clientUploadId: string;
  recordingId?: string;
  authorizationId?: string;
  authorizationExpiresAt?: string;
}): Promise<QueueItem> {
  const source = new File(input.sourceUri);
  if (input.durationSeconds > MAX_RECORDING_SECONDS) throw new RecordingLimitError("recording_too_long");
  if (source.size > MAX_RECORDING_BYTES) throw new RecordingLimitError("recording_too_large");

  const id = uuid();
  const dir = itemDirectory(id);
  dir.create({ idempotent: true, intermediates: true });
  const hash = sha256.create();
  const handle = source.open(FileMode.ReadOnly);
  let chunkCount = 0;
  let sizeBytes = 0;

  try {
    while ((handle.offset ?? 0) < (handle.size ?? 0)) {
      const remaining = (handle.size ?? 0) - (handle.offset ?? 0);
      const plain = handle.readBytes(Math.min(RECORDING_CHUNK_BYTES, remaining));
      if (plain.length === 0) break;
      hash.update(plain);
      sizeBytes += plain.length;
      const encrypted = await encryptBytes(plain, `audio:${id}:${chunkCount}`);
      const target = chunkFile(id, chunkCount);
      target.create({ overwrite: true, intermediates: true });
      target.write(encrypted);
      chunkCount += 1;
    }
  } catch (error) {
    if (dir.exists) dir.delete();
    throw error;
  } finally {
    handle.close();
  }

  const payload: QueuePayload = {
    consultationId: input.consultationId,
    orgId: input.orgId,
    patientId: input.patientId,
    durationSeconds: input.durationSeconds,
    sizeBytes,
    checksumSha256: bytesToHex(hash.digest()),
    chunkCount,
    mime: "audio/m4a",
    mode: input.mode,
    clientUploadId: input.clientUploadId,
    recordingId: input.recordingId,
    authorizationId: input.authorizationId,
    authorizationExpiresAt: input.authorizationExpiresAt,
  };
  const now = new Date().toISOString();
  const encryptedPayload = await encryptJson(payload, `queue:${id}`);
  const db = await database();
  try {
    await db.runAsync(
      `INSERT INTO recording_queue
       (id, state, payload_ciphertext, created_at, updated_at, attempts, progress)
       VALUES (?, 'local', ?, ?, ?, 0, 0)`,
      id,
      encryptedPayload,
      now,
      now,
    );
    if (source.exists) source.delete();
  } catch (error) {
    if (dir.exists) dir.delete();
    throw error;
  }

  return { id, state: "local", createdAt: now, updatedAt: now, attempts: 0, progress: 0, ...payload };
}

/** Preserve an interrupted capture as an explicit, inspectable queue item.
 * It is never silently discarded even when the operating system removed the
 * unfinished source file. */
export async function persistQuarantinedRecording(
  input: Omit<QueuePayload, "durationSeconds" | "sizeBytes" | "checksumSha256" | "chunkCount" | "mime"> & {
    durationSeconds?: number;
    errorCode: string;
  },
): Promise<QueueItem> {
  const id = uuid();
  const payload: QueuePayload = {
    consultationId: input.consultationId,
    orgId: input.orgId,
    patientId: input.patientId,
    durationSeconds: Math.max(input.durationSeconds ?? 0, 0),
    sizeBytes: 0,
    checksumSha256: "",
    chunkCount: 0,
    mime: "audio/m4a",
    mode: input.mode,
    clientUploadId: input.clientUploadId,
    recordingId: input.recordingId,
    authorizationId: input.authorizationId,
    authorizationExpiresAt: input.authorizationExpiresAt,
  };
  const now = new Date().toISOString();
  const encryptedPayload = await encryptJson(payload, `queue:${id}`);
  const db = await database();
  await db.runAsync(
    `INSERT INTO recording_queue
     (id, state, payload_ciphertext, created_at, updated_at, attempts, progress, error_code)
     VALUES (?, 'quarantined', ?, ?, ?, 0, 0, ?)`,
    id,
    encryptedPayload,
    now,
    now,
    input.errorCode,
  );
  return {
    id,
    state: "quarantined",
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    progress: 0,
    errorCode: input.errorCode,
    quarantined: true,
    ...payload,
  };
}

export async function hasAllEncryptedChunks(item: QueueItem): Promise<boolean> {
  if (item.quarantined || item.chunkCount <= 0) return false;
  for (let index = 0; index < item.chunkCount; index += 1) {
    if (!chunkFile(item.id, index).exists) return false;
  }
  return true;
}

export async function createTemporaryPlainFile(item: QueueItem): Promise<File> {
  const directory = new Directory(Paths.cache, "medchina-upload-v1");
  directory.create({ idempotent: true, intermediates: true });
  const target = new File(directory, `${item.id}.m4a`);
  target.create({ overwrite: true, intermediates: true });
  const output = target.open(FileMode.WriteOnly);
  try {
    for (let index = 0; index < item.chunkCount; index += 1) {
      const encrypted = await chunkFile(item.id, index).bytes();
      const plain = await decryptBytes(encrypted, `audio:${item.id}:${index}`);
      output.writeBytes(plain);
    }
  } catch (error) {
    output.close();
    if (target.exists) target.delete();
    throw error;
  }
  output.close();
  return target;
}

export function deleteEncryptedAudio(id: string): void {
  const directory = itemDirectory(id);
  if (directory.exists) directory.delete();
}

export async function deleteQueueItem(id: string): Promise<void> {
  const db = await database();
  await db.runAsync("DELETE FROM recording_queue WHERE id = ?", id);
  deleteEncryptedAudio(id);
}

type StoredUpload = {
  size: number | null;
  metadata: Record<string, string>;
  creationTime: string;
  urlStorageKey: string;
  uploadUrl: string | null;
  parallelUploadUrls: string[] | null;
};

const fingerprintHash = (fingerprint: string) => bytesToHex(sha256(new TextEncoder().encode(fingerprint)));

export const secureTusUrlStorage = {
  async findAllUploads(): Promise<StoredUpload[]> {
    const db = await database();
    const rows = await db.getAllAsync<TusRow>("SELECT key, payload_ciphertext FROM tus_uploads ORDER BY created_at DESC");
    const uploads: StoredUpload[] = [];
    for (const row of rows) {
      try {
        const value = await decryptJson<{ upload: StoredUpload }>(row.payload_ciphertext, `tus:${row.key}`);
        uploads.push(value.upload);
      } catch {
        await db.runAsync("DELETE FROM tus_uploads WHERE key = ?", row.key);
      }
    }
    return uploads;
  },
  async findUploadsByFingerprint(fingerprint: string): Promise<StoredUpload[]> {
    const db = await database();
    const rows = await db.getAllAsync<TusRow>(
      "SELECT key, payload_ciphertext FROM tus_uploads WHERE fingerprint_hash = ? ORDER BY created_at DESC",
      fingerprintHash(fingerprint),
    );
    const uploads: StoredUpload[] = [];
    for (const row of rows) {
      try {
        const value = await decryptJson<{ fingerprint: string; upload: StoredUpload }>(
          row.payload_ciphertext,
          `tus:${row.key}`,
        );
        if (value.fingerprint === fingerprint) uploads.push(value.upload);
      } catch {
        await db.runAsync("DELETE FROM tus_uploads WHERE key = ?", row.key);
      }
    }
    return uploads;
  },
  async removeUpload(key: string): Promise<void> {
    const db = await database();
    await db.runAsync("DELETE FROM tus_uploads WHERE key = ?", key);
  },
  async addUpload(fingerprint: string, upload: StoredUpload): Promise<string> {
    const db = await database();
    const key = uuid();
    const stored = { ...upload, urlStorageKey: key };
    const encrypted = await encryptJson({ fingerprint, upload: stored }, `tus:${key}`);
    await db.runAsync(
      "INSERT INTO tus_uploads (key, fingerprint_hash, payload_ciphertext, created_at) VALUES (?, ?, ?, ?)",
      key,
      fingerprintHash(fingerprint),
      encrypted,
      new Date().toISOString(),
    );
    return key;
  },
};
