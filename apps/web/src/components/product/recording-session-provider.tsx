"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Upload } from "tus-js-client";

import { createClient } from "@flyee/auth/client";

const DB_NAME = "medchina-recordings";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const KEY_STORE = "keys";
const KEY_ID = "capture-key";

export type PersistedWebRecording = {
  recordingId: string;
  consultationId: string;
  orgId: string;
  duration: number;
  mime: string;
  checksumSha256: string;
  createdAt: string;
  mode?: "ai" | "audio_only";
  blob: Blob;
};

type EncryptedRow = Omit<PersistedWebRecording, "blob"> & {
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

type RecordingSessionContextValue = {
  active: boolean;
  setActive: (active: boolean) => void;
  persist: (value: PersistedWebRecording) => Promise<void>;
  recover: (consultationId: string) => Promise<PersistedWebRecording | null>;
  remove: (recordingId: string) => Promise<void>;
  uploadTus: (value: PersistedWebRecording, path: string, onProgress: (progress: number) => void) => Promise<void>;
};

const RecordingSessionContext = createContext<RecordingSessionContextValue | null>(null);

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexed_db_failed"));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(SESSION_STORE)) {
      const store = database.createObjectStore(SESSION_STORE, { keyPath: "recordingId" });
      store.createIndex("consultationId", "consultationId");
    }
    if (!database.objectStoreNames.contains(KEY_STORE)) database.createObjectStore(KEY_STORE);
  };
  return requestResult(request);
}

async function cryptoKey(database: IDBDatabase): Promise<CryptoKey> {
  const existing = await requestResult(database.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE).get(KEY_ID));
  if (existing instanceof CryptoKey) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await requestResult(database.transaction(KEY_STORE, "readwrite").objectStore(KEY_STORE).put(key, KEY_ID));
  return key;
}

async function storeRecording(value: PersistedWebRecording): Promise<void> {
  const database = await openDatabase();
  const key = await cryptoKey(database);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(value.recordingId) },
    key,
    await value.blob.arrayBuffer(),
  );
  const metadata: Omit<PersistedWebRecording, "blob"> = {
    recordingId: value.recordingId,
    consultationId: value.consultationId,
    orgId: value.orgId,
    duration: value.duration,
    mime: value.mime,
    checksumSha256: value.checksumSha256,
    createdAt: value.createdAt,
  };
  await requestResult(
    database
      .transaction(SESSION_STORE, "readwrite")
      .objectStore(SESSION_STORE)
      .put({
        ...metadata,
        iv: iv.buffer,
        ciphertext,
      } satisfies EncryptedRow),
  );
  database.close();
}

async function recoverRecording(consultationId: string): Promise<PersistedWebRecording | null> {
  const database = await openDatabase();
  const rows = (await requestResult(
    database
      .transaction(SESSION_STORE, "readonly")
      .objectStore(SESSION_STORE)
      .index("consultationId")
      .getAll(consultationId),
  )) as EncryptedRow[];
  const row = rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!row) {
    database.close();
    return null;
  }
  try {
    const key = await cryptoKey(database);
    const clear = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(row.iv),
        additionalData: new TextEncoder().encode(row.recordingId),
      },
      key,
      row.ciphertext,
    );
    return {
      recordingId: row.recordingId,
      consultationId: row.consultationId,
      orgId: row.orgId,
      duration: row.duration,
      mime: row.mime,
      checksumSha256: row.checksumSha256,
      createdAt: row.createdAt,
      blob: new Blob([clear], { type: row.mime }),
    };
  } catch {
    // A corrupt encrypted row is retained for support/forensics. It is never
    // silently presented as uploaded or deleted.
    return null;
  } finally {
    database.close();
  }
}

async function removeRecording(recordingId: string): Promise<void> {
  const database = await openDatabase();
  await requestResult(database.transaction(SESSION_STORE, "readwrite").objectStore(SESSION_STORE).delete(recordingId));
  database.close();
}

function tusEndpoint(): string | null {
  const source = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!source) return null;
  const direct = source.replace(/^(https:\/\/[^.]+)\.supabase\.co$/i, "$1.storage.supabase.co");
  return `${direct.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

export default function RecordingSessionProvider({
  children,
  exitMessage,
}: {
  children: ReactNode;
  exitMessage: string;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!active) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const protectInternalNavigation = (event: MouseEvent) => {
      if (!active) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === "_blank") return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (!window.confirm(exitMessage)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", protectInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", protectInternalNavigation, true);
    };
  }, [active, exitMessage]);

  const uploadTus = useCallback(
    async (value: PersistedWebRecording, path: string, onProgress: (progress: number) => void) => {
      const endpoint = tusEndpoint();
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const {
        data: { session },
      } = await createClient().auth.getSession();
      if (!endpoint || !anonKey || !session) throw new Error("upload_unavailable");

      await new Promise<void>((resolve, reject) => {
        const upload = new Upload(value.blob, {
          endpoint,
          chunkSize: 6 * 1024 * 1024,
          retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
          removeFingerprintOnSuccess: true,
          uploadDataDuringCreation: true,
          metadata: {
            bucketName: "transcriptions",
            objectName: path,
            contentType: value.mime,
            cacheControl: "3600",
            metadata: JSON.stringify({ checksum_sha256: value.checksumSha256 }),
          },
          headers: {
            authorization: `Bearer ${session.access_token}`,
            apikey: anonKey,
            "x-upsert": "true",
          },
          fingerprint: async () => `medchina-web-${value.recordingId}-${value.checksumSha256}`,
          onProgress: (sent, total) => onProgress(total > 0 ? sent / total : 0),
          onError: reject,
          onSuccess: () => resolve(),
        });
        void upload
          .findPreviousUploads()
          .then((previous) => {
            if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
            upload.start();
          })
          .catch(reject);
      });
    },
    [],
  );

  const value = useMemo<RecordingSessionContextValue>(
    () => ({
      active,
      setActive,
      persist: storeRecording,
      recover: recoverRecording,
      remove: removeRecording,
      uploadTus,
    }),
    [active, uploadTus],
  );

  return <RecordingSessionContext.Provider value={value}>{children}</RecordingSessionContext.Provider>;
}

export function useRecordingSession(): RecordingSessionContextValue {
  const value = useContext(RecordingSessionContext);
  if (!value) throw new Error("useRecordingSession must be used within RecordingSessionProvider");
  return value;
}
