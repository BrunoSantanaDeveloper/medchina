"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "tus-js-client";

import { Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import { assembleChunks, type StoredChunk } from "@/lib/recording-buffer";
import { createClient } from "@flyee/auth/client";

const DB_NAME = "medchina-recordings";
/** v2 adds the chunk store that keeps a capture recoverable WHILE it runs. */
const DB_VERSION = 2;
const SESSION_STORE = "sessions";
const CHUNK_STORE = "chunks";
const CHUNK_META_STORE = "chunkMeta";
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
  /** Assembled from batches after a crash: the take never reached its end. */
  partial?: boolean;
};

type EncryptedRow = Omit<PersistedWebRecording, "blob"> & {
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

/** One encrypted batch of a capture still in progress. */
type ChunkRow = {
  recordingId: string;
  seq: number;
  consultationId: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

/**
 * What a partially captured take needs to become a usable recording. The
 * duration is NOT derivable from a truncated WebM, so the wall-clock elapsed
 * time is written alongside every batch.
 */
export type ChunkMeta = {
  recordingId: string;
  consultationId: string;
  orgId: string;
  mime: string;
  mode: "ai" | "audio_only";
  elapsedSeconds: number;
  createdAt: string;
  updatedAt: string;
};

type RecordingSessionContextValue = {
  active: boolean;
  setActive: (active: boolean) => void;
  persist: (value: PersistedWebRecording) => Promise<void>;
  /** Write one batch of a capture still in progress, so a crash costs seconds. */
  appendChunk: (meta: ChunkMeta, seq: number, parts: Blob[]) => Promise<void>;
  clearChunks: (recordingId: string) => Promise<void>;
  recover: (consultationId: string) => Promise<PersistedWebRecording | null>;
  remove: (recordingId: string) => Promise<void>;
  uploadTus: (value: PersistedWebRecording, path: string, onProgress: (progress: number) => void) => Promise<void>;
  /**
   * Navigate, asking first when a capture is running.
   *
   * The link and Back guards intercept the DOM; a `router.push` never touches
   * it. The command palette is reachable with ⌘K from the consultation screen,
   * so it was a door straight out of a running capture with no dialog and no
   * `beforeunload` — client-side navigation fires neither.
   */
  navigate: (href: string) => void;
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
    if (!database.objectStoreNames.contains(CHUNK_STORE)) {
      // Keyed by (recording, seq) so a batch can only ever overwrite ITSELF —
      // a retry can never reorder the stream or duplicate a slice.
      const chunks = database.createObjectStore(CHUNK_STORE, { keyPath: ["recordingId", "seq"] });
      chunks.createIndex("recordingId", "recordingId");
      chunks.createIndex("consultationId", "consultationId");
    }
    if (!database.objectStoreNames.contains(CHUNK_META_STORE)) {
      const meta = database.createObjectStore(CHUNK_META_STORE, { keyPath: "recordingId" });
      meta.createIndex("consultationId", "consultationId");
    }
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

/**
 * Write one batch of a capture that is still running, encrypted like the final
 * blob. `additionalData` binds the ciphertext to its POSITION as well as its
 * recording, so a batch cannot be replayed into another slot.
 */
async function storeChunk(meta: ChunkMeta, seq: number, parts: Blob[]): Promise<void> {
  const database = await openDatabase();
  try {
    const key = await cryptoKey(database);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${meta.recordingId}:${seq}`) },
      key,
      await new Blob(parts).arrayBuffer(),
    );
    const transaction = database.transaction([CHUNK_STORE, CHUNK_META_STORE], "readwrite");
    transaction.objectStore(CHUNK_STORE).put({
      recordingId: meta.recordingId,
      seq,
      consultationId: meta.consultationId,
      iv: iv.buffer,
      ciphertext,
    } satisfies ChunkRow);
    // Rewritten on every batch: the elapsed time is the only record of how long
    // a truncated capture actually ran.
    transaction.objectStore(CHUNK_META_STORE).put(meta);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("indexed_db_failed"));
    });
  } finally {
    database.close();
  }
}

/**
 * Rebuild whatever was captured before the tab died. Returns null when there is
 * nothing, or when the batches cannot make a playable file (see
 * `assembleChunks`) — a partial recording is offered honestly or not at all.
 */
async function recoverChunks(consultationId: string): Promise<PersistedWebRecording | null> {
  const database = await openDatabase();
  try {
    const metas = (await requestResult(
      database
        .transaction(CHUNK_META_STORE, "readonly")
        .objectStore(CHUNK_META_STORE)
        .index("consultationId")
        .getAll(consultationId),
    )) as ChunkMeta[];
    const meta = metas.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!meta) return null;

    const rows = (await requestResult(
      database
        .transaction(CHUNK_STORE, "readonly")
        .objectStore(CHUNK_STORE)
        .index("recordingId")
        .getAll(meta.recordingId),
    )) as ChunkRow[];

    const key = await cryptoKey(database);
    const decrypted: StoredChunk[] = [];
    for (const row of rows) {
      try {
        const clear = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: new Uint8Array(row.iv),
            additionalData: new TextEncoder().encode(`${row.recordingId}:${row.seq}`),
          },
          key,
          row.ciphertext,
        );
        decrypted.push({ seq: row.seq, data: clear });
      } catch {
        // One unreadable batch is a hole; assembleChunks refuses the sequence.
      }
    }

    const parts = assembleChunks(decrypted);
    if (!parts) return null;
    const blob = new Blob(parts, { type: meta.mime });
    const checksumSha256 = await sha256Hex(blob);
    if (!checksumSha256) return null;
    return {
      recordingId: meta.recordingId,
      consultationId: meta.consultationId,
      orgId: meta.orgId,
      duration: meta.elapsedSeconds,
      mime: meta.mime,
      checksumSha256,
      createdAt: meta.createdAt,
      mode: meta.mode,
      blob,
      partial: true,
    };
  } catch {
    return null;
  } finally {
    database.close();
  }
}

async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/**
 * The best copy of this consultation that survives locally.
 *
 * A take that reached its end left a complete blob in `sessions`; one that was
 * cut short by a crash left only its batches. Preferring the complete row keeps
 * the normal path untouched, and falling through to the batches is what turns
 * "the tab died, the consultation is gone" into "here are the 47 minutes we
 * had, send them".
 */
async function recoverSession(consultationId: string): Promise<PersistedWebRecording | null> {
  const complete = await recoverRecording(consultationId);
  if (complete) return complete;
  return recoverChunks(consultationId);
}

async function removeChunks(recordingId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([CHUNK_STORE, CHUNK_META_STORE], "readwrite");
    const index = transaction.objectStore(CHUNK_STORE).index("recordingId");
    const keys = (await requestResult(index.getAllKeys(recordingId))) as IDBValidKey[];
    for (const storeKey of keys) transaction.objectStore(CHUNK_STORE).delete(storeKey);
    transaction.objectStore(CHUNK_META_STORE).delete(recordingId);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("indexed_db_failed"));
    });
  } finally {
    database.close();
  }
}

async function removeRecording(recordingId: string): Promise<void> {
  const database = await openDatabase();
  await requestResult(database.transaction(SESSION_STORE, "readwrite").objectStore(SESSION_STORE).delete(recordingId));
  database.close();
  // The final blob supersedes the batches it was assembled from.
  await removeChunks(recordingId);
}

function tusEndpoint(): string | null {
  const source = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!source) return null;
  const direct = source.replace(/^(https:\/\/[^.]+)\.supabase\.co$/i, "$1.storage.supabase.co");
  return `${direct.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

/**
 * Marks the history entry the guard keeps in front of the page, so a second
 * capture on the same page does not stack another copy of it.
 */
const HISTORY_GUARD_KEY = "medchinaRecordingGuard";

/** Where she was heading when the guard stopped her, kept so the navigation can
 * be replayed: a dialog answers long after the event that was cancelled, where
 * the browser popup it replaced answered inside it. */
type PendingExit = { kind: "link"; href: string } | { kind: "back" };

export default function RecordingSessionProvider({
  children,
}: {
  children: ReactNode;
  /**
   * @deprecated No longer read: `beforeunload` cannot carry custom text, and
   * the in-app guard resolves its own copy. Kept in the signature so the
   * dashboard layout keeps compiling until it stops passing it.
   */
  exitMessage?: string;
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);
  /** True while the guard is itself walking back through history, so its own
   * `popstate` does not re-arm the trap it is walking out of. */
  const leavingRef = useRef(false);
  /** Releases `leavingRef` when the history move produced no popstate at all. */
  const leaveTimeout = useRef<number | null>(null);

  useEffect(() => {
    // Closing the tab is the browser's dialog, not ours — custom text has been
    // ignored there for years, and no in-page dialog can hold an unload back.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!active) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const protectInternalNavigation = (event: MouseEvent) => {
      if (!active || event.defaultPrevented || event.button !== 0) return;
      // A modified click opens somewhere else (new tab/window, download): this
      // page keeps its capture, so there is nothing to interrupt.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === "_blank" || target.hasAttribute("download"))
        return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      // Same document, different hash: nothing unmounts, the microphone stays.
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      // The navigation is always stopped here and replayed on confirmation —
      // the dialog answers after the event has long finished.
      event.preventDefault();
      event.stopPropagation();
      setPendingExit({ kind: "link", href: `${destination.pathname}${destination.search}${destination.hash}` });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", protectInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", protectInternalNavigation, true);
    };
  }, [active]);

  /**
   * The back button cannot be cancelled — by the time `popstate` fires the
   * browser has already moved. So while a capture runs the guard keeps a
   * DUPLICATE of the current entry in front of the page: Back pops that one
   * (same URL, nothing unmounts, the microphone keeps running), the duplicate
   * is pushed again and the question is asked with the capture still intact.
   *
   * The entry is deliberately left behind when the capture ends: one extra Back
   * press costs a click, while rewriting history from a cleanup that also runs
   * mid-navigation could send her somewhere she never asked to go.
   */
  useEffect(() => {
    if (!active) return;
    leavingRef.current = false;
    const arm = () => {
      const state = window.history.state as Record<string, unknown> | null;
      if (state?.[HISTORY_GUARD_KEY]) return;
      // No URL argument and the router's own state carried over: this is a
      // duplicate of the current entry, never a navigation.
      window.history.pushState({ ...state, [HISTORY_GUARD_KEY]: true }, "");
    };
    const onPopState = () => {
      // Consumed ONCE. Leaving it latched is how the guard silently disarms
      // itself: `history.go()` is a no-op when the target is out of range (the
      // consultation opened in a fresh tab from a link), no popstate ever
      // arrives, and every later Back would then walk out of a running capture
      // without a word.
      if (leavingRef.current) {
        leavingRef.current = false;
        return;
      }
      arm();
      setPendingExit({ kind: "back" });
    };
    arm();
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (leaveTimeout.current) window.clearTimeout(leaveTimeout.current);
    };
  }, [active]);

  // The dialog states that a capture is running; it must never outlive one (a
  // lost device or a finished take ends the capture without her answering).
  useEffect(() => {
    if (!active) setPendingExit(null);
  }, [active]);

  const stayOnPage = useCallback(() => setPendingExit(null), []);

  const leaveAnyway = useCallback(() => {
    const destination = pendingExit;
    setPendingExit(null);
    if (!destination) return;
    if (destination.kind === "back") {
      // Two entries back when we are standing on the guard's duplicate: past it
      // and then the step she actually asked for. The mark is read from history
      // instead of assumed, because a `router.refresh()` rewrites the entry's
      // state and can drop it — one step is then the honest move. The listener
      // stands down first, or it would re-arm the trap on the way out and ask
      // again forever.
      leavingRef.current = true;
      // …and released if nothing came of it. `go()` out of range never fires a
      // popstate, so without this the flag would stay latched for the rest of
      // the capture.
      if (leaveTimeout.current) window.clearTimeout(leaveTimeout.current);
      leaveTimeout.current = window.setTimeout(() => {
        leavingRef.current = false;
      }, 500);
      const state = window.history.state as Record<string, unknown> | null;
      window.history.go(state?.[HISTORY_GUARD_KEY] ? -2 : -1);
      return;
    }
    router.push(destination.href);
  }, [pendingExit, router]);

  /** Programmatic navigation, held back by the same dialog as a link click. */
  const navigate = useCallback(
    (href: string) => {
      if (!active) {
        router.push(href);
        return;
      }
      setPendingExit({ kind: "link", href });
    },
    [active, router],
  );

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
      appendChunk: storeChunk,
      clearChunks: removeChunks,
      recover: recoverSession,
      remove: removeRecording,
      uploadTus,
      navigate,
    }),
    [active, navigate, uploadTus],
  );

  return (
    <RecordingSessionContext.Provider value={value}>
      {children}
      {/*
        This provider wraps the whole dashboard, so the guard must add no layout
        of its own: a Dialog renders into a portal and only exists while she is
        being asked. Dismissing it (Esc, backdrop, X) is the safe answer — she
        stays on the page and the capture continues.
      */}
      <Dialog open={pendingExit !== null} onClose={stayOnPage} maxWidth="xs" fullWidth>
        <DialogHeader title={t("recorder-leave-title")} closeLabel={t("close")} onClose={stayOnPage} />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("recorder-leave-body")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={leaveAnyway}>
            {t("recorder-leave-confirm")}
          </Button>
          {/* Staying is the default: it is the outcome that loses nothing. */}
          <Button variant="contained" color="primary" autoFocus onClick={stayOnPage}>
            {t("recorder-leave-stay")}
          </Button>
        </DialogActions>
      </Dialog>
    </RecordingSessionContext.Provider>
  );
}

export function useRecordingSession(): RecordingSessionContextValue {
  const value = useContext(RecordingSessionContext);
  if (!value) throw new Error("useRecordingSession must be used within RecordingSessionProvider");
  return value;
}

/**
 * The same context where the provider may legitimately be absent.
 *
 * The support widget is mounted in BOTH layouts, and the marketing site has no
 * capture session — reaching for the throwing hook there would take the public
 * site down. Anything that merely wants to KNOW whether a capture is running,
 * rather than drive one, belongs here.
 */
export function useRecordingSessionOptional(): RecordingSessionContextValue | null {
  return useContext(RecordingSessionContext);
}
