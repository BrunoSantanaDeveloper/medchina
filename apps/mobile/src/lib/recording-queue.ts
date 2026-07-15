import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";

import { supabase } from "@/lib/supabase";

/**
 * The resilient upload queue (PRD §11 "envio protegido e retomada após falhas de
 * conexão"; §12.4).
 *
 * The promise the product makes: **a bad connection must never mean a lost
 * consultation.** So the audio is moved to persistent storage the moment the
 * recording stops, and the queue survives app restarts. Nothing is ever deleted
 * from the device until the SERVER confirms it (HOME-SPEC §22.3) — the local
 * copy is the safety net, not a formality.
 *
 * The three states the app must be able to say out loud, honestly:
 *   local     — still on this phone only
 *   uploading — being sent
 *   uploaded  — the server accepted it
 *
 * `blocked` is separate and deliberate: the database refused the recording
 * (no consent, or no audio allowance). The audio STAYS on the device and the
 * professional is told why — we never silently discard a consultation she
 * actually recorded.
 */

const QUEUE_KEY = "medchina.recording-queue.v1";
const AUDIO_DIR = "recordings";
/** m4a: what expo-audio's HIGH_QUALITY preset writes on both platforms. */
const MIME = "audio/m4a";

export type QueueState = "local" | "uploading" | "uploaded" | "blocked";

export type QueueItem = {
  id: string;
  consultationId: string;
  orgId: string;
  patientId: string;
  /** File name inside the app's persistent recordings directory. */
  fileName: string;
  durationSeconds: number;
  createdAt: string;
  /** Set once the database row exists — a retry resumes, it never re-inserts. */
  recordingId?: string;
  state: QueueState;
  error?: string;
};

const recordingsDir = () => new Directory(Paths.document, AUDIO_DIR);

export async function readQueue(): Promise<QueueItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueueItem[];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

async function updateItem(id: string, patch: Partial<QueueItem>): Promise<QueueItem[]> {
  const items = await readQueue();
  const next = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
  await writeQueue(next);
  return next;
}

/**
 * Take the just-finished recording out of the cache (which the OS may evict)
 * and into persistent storage, then queue it. Called the instant recording
 * stops — before anything can go wrong with the network.
 */
export async function enqueueRecording(input: {
  sourceUri: string;
  consultationId: string;
  orgId: string;
  patientId: string;
  durationSeconds: number;
}): Promise<QueueItem> {
  const dir = recordingsDir();
  if (!dir.exists) dir.create({ intermediates: true });

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fileName = `${id}.m4a`;

  const source = new File(input.sourceUri);
  const target = new File(dir, fileName);
  source.move(target);

  const item: QueueItem = {
    id,
    consultationId: input.consultationId,
    orgId: input.orgId,
    patientId: input.patientId,
    fileName,
    durationSeconds: input.durationSeconds,
    createdAt: new Date().toISOString(),
    state: "local",
  };

  await writeQueue([...(await readQueue()), item]);
  return item;
}

/** Errors the DB guards raise — the audio is kept and the reason is shown. */
const GUARD_ERRORS = ["audio-recording consent", "trial_not_started", "audio_allowance_exhausted"];
const isGuardError = (message: string) => GUARD_ERRORS.some((needle) => message.includes(needle));

/**
 * Push one item as far as it can go. Split into steps so a retry resumes from
 * where it stopped instead of duplicating work (or the recording row).
 */
async function flushItem(item: QueueItem): Promise<void> {
  if (!supabase || item.state === "uploaded") return;

  const file = new File(recordingsDir(), item.fileName);
  if (!file.exists) {
    // The audio is gone (manual cleanup / reinstall) — drop the dead entry
    // rather than retry forever.
    await writeQueue((await readQueue()).filter((entry) => entry.id !== item.id));
    return;
  }

  await updateItem(item.id, { state: "uploading", error: undefined });

  let recordingId = item.recordingId;

  // 1. The row. The database decides here: consent (0022) and audio allowance
  //    (0024) are both enforced by triggers — the app does not re-implement them.
  if (!recordingId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: acceptance } = await supabase
      .from("consent_acceptances")
      .select("id")
      .eq("org_id", item.orgId)
      .eq("subject_type", "patient")
      .eq("subject_id", item.patientId)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();

    const { data, error } = await supabase
      .from("recordings")
      .insert({
        org_id: item.orgId,
        patient_id: item.patientId,
        consultation_id: item.consultationId,
        status: "uploading",
        mime: MIME,
        duration_seconds: item.durationSeconds,
        size_bytes: file.size ?? null,
        consent_acceptance_id: acceptance?.id ?? null,
        captured_on: "mobile",
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();

    if (error || !data) {
      const message = error?.message ?? "insert failed";
      // A guard refusal is not a network blip: stop retrying, keep the audio,
      // and tell her why (she may need to grant consent or contract on the web).
      await updateItem(item.id, { state: isGuardError(message) ? "blocked" : "local", error: message });
      return;
    }
    recordingId = data.id as string;
    await updateItem(item.id, { recordingId });
  }

  // 2. The bytes. ArrayBuffer is what React Native's fetch reliably accepts as
  //    a body; the exact slice avoids sending a larger backing buffer.
  const bytes = await file.bytes();
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const path = `${item.orgId}/${recordingId}.m4a`;

  const { error: uploadError } = await supabase.storage
    .from("transcriptions")
    .upload(path, body, { contentType: MIME, upsert: true });

  if (uploadError) {
    await updateItem(item.id, { state: "local", error: uploadError.message });
    return;
  }

  // 3. Only NOW is it "sent" — the server has the object (PRD §12.4).
  const { error: confirmError } = await supabase
    .from("recordings")
    .update({ status: "uploaded", audio_path: path })
    .eq("id", recordingId);

  if (confirmError) {
    await updateItem(item.id, { state: "local", error: confirmError.message });
    return;
  }

  // 4. The device copy goes only after the server confirmed (HOME-SPEC §22.3).
  try {
    file.delete();
  } catch {
    // A file we cannot delete is not a reason to keep the queue entry.
  }
  await writeQueue((await readQueue()).filter((entry) => entry.id !== item.id));
}

/**
 * Try to send everything still pending. Safe to call often (on app focus, after
 * a new recording, or from a manual retry) — `uploaded` and `blocked` items are
 * skipped, and a `blocked` one only moves again when explicitly retried.
 */
export async function flushQueue(): Promise<QueueItem[]> {
  const items = await readQueue();
  for (const item of items) {
    if (item.state === "local") await flushItem(item);
  }
  return readQueue();
}

/** Explicit retry of an item the database refused (after fixing the cause). */
export async function retryItem(id: string): Promise<QueueItem[]> {
  await updateItem(id, { state: "local", error: undefined });
  const items = await readQueue();
  const item = items.find((entry) => entry.id === id);
  if (item) await flushItem({ ...item, state: "local" });
  return readQueue();
}

/** Pending items for one consultation (what the capture screen shows). */
export async function queueForConsultation(consultationId: string): Promise<QueueItem[]> {
  return (await readQueue()).filter((item) => item.consultationId === consultationId);
}
