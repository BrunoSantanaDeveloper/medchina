import { File } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { Upload } from "tus-js-client";

import {
  acquireUploadLease,
  createTemporaryPlainFile,
  deleteEncryptedAudio,
  getQueueItem,
  hasAllEncryptedChunks,
  persistEncryptedRecording,
  queueForConsultation,
  quarantineQueueItem,
  readQueue,
  secureTusUrlStorage,
  updateQueueItem,
  type QueueItem,
  type QueueState,
  type RecordingMode,
} from "@/lib/recording-store";
import {
  isDeliveredRecordingStatus,
  isProcessingDispatchAccepted,
  type DeliveredRecordingStatus,
} from "@/lib/recording-state";
import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import { trackProductEvent } from "@/lib/product-events";

export type { QueueItem, QueueState } from "@/lib/recording-store";

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, "");
const RETRY_DELAYS = [0, 1_000, 3_000, 5_000, 10_000];

type RpcResult = {
  ok?: boolean;
  code?: string;
  status?: string;
  recordingId?: string;
};

function stableError(value: unknown): string {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("consent") || text.includes("audio-recording")) return "audio_consent_required";
  if (text.includes("allowance") || text.includes("trial_not_started")) return "allowance_unavailable";
  if (text.includes("already_open") || text.includes("pending")) return "recording_pending";
  if (text.includes("checksum")) return "checksum_mismatch";
  if (text.includes("not_authorized") || text.includes("not authenticated")) return "not_authorized";
  if (text.includes("invalid_consultation")) return "invalid_consultation_transition";
  if (text.includes("not_uploaded")) return "recording_not_uploaded";
  return "network_unavailable";
}

async function rpc(name: string, params: Record<string, unknown>): Promise<RpcResult> {
  if (!supabase) return { ok: false, code: "network_unavailable" };
  const { data, error } = await supabase.rpc(name, params);
  if (error) return { ok: false, code: stableError(error.message) };
  return (data ?? { ok: false, code: "network_unavailable" }) as RpcResult;
}

function storageTusEndpoint(): string | null {
  if (!supabaseUrl) return null;
  const direct = supabaseUrl.replace(/^(https:\/\/[^.]+)\.supabase\.co$/i, "$1.storage.supabase.co");
  return `${direct.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

async function uploadWithTus(item: QueueItem, plainFile: File, path: string): Promise<void> {
  if (!supabase || !supabaseAnonKey) throw new Error("network_unavailable");
  const endpoint = storageTusEndpoint();
  if (!endpoint) throw new Error("network_unavailable");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authorized");

  await new Promise<void>((resolve, reject) => {
    const input = { uri: plainFile.uri, name: `${item.recordingId}.m4a`, type: item.mime } as unknown as File;
    const upload = new Upload(input, {
      endpoint,
      uploadSize: item.sizeBytes,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: RETRY_DELAYS,
      removeFingerprintOnSuccess: true,
      uploadDataDuringCreation: true,
      metadata: {
        bucketName: "transcriptions",
        objectName: path,
        contentType: item.mime,
        cacheControl: "3600",
        metadata: JSON.stringify({ checksum_sha256: item.checksumSha256 }),
      },
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: supabaseAnonKey,
        "x-upsert": "true",
      },
      fingerprint: async () => `medchina-${item.clientUploadId}-${item.checksumSha256}`,
      urlStorage: secureTusUrlStorage,
      onProgress: (sent, total) => {
        void updateQueueItem(item.id, { progress: total > 0 ? sent / total : 0 });
      },
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
}

async function ensureRemoteRecording(item: QueueItem): Promise<QueueItem> {
  if (item.recordingId) return item;
  const result = await rpc("begin_authorized_mobile_recording", {
    target_consultation: item.consultationId,
    target_mode: item.mode,
    target_client_upload_id: item.clientUploadId,
    target_authorization: item.authorizationId,
    target_captured_at: item.createdAt,
  });
  if (!result.ok || !result.recordingId) throw new Error(result.code ?? "network_unavailable");
  const updated = await updateQueueItem(item.id, { payload: { recordingId: result.recordingId } });
  if (!updated) throw new Error("queue_item_missing");
  return updated;
}

async function remoteRecordingState(recordingId: string): Promise<{ status: string; audioPath: string | null } | null> {
  if (!supabase) throw new Error("network_unavailable");
  const { data, error } = await supabase
    .from("recordings")
    .select("status,audio_path")
    .eq("id", recordingId)
    .maybeSingle();
  if (error) throw new Error(stableError(error.message));
  return data ? { status: data.status, audioPath: data.audio_path } : null;
}

async function markLocal(item: QueueItem): Promise<"local" | "uploading" | DeliveredRecordingStatus> {
  if (!item.recordingId) throw new Error("recording_missing");
  const result = await rpc("mark_recording_local", {
    target_recording: item.recordingId,
    target_duration_seconds: item.durationSeconds,
    target_size_bytes: item.sizeBytes,
    target_mime: item.mime,
    target_checksum_sha256: item.checksumSha256,
  });
  // A response may have been lost after a prior success. Later states are safe
  // to resume; the immutable client upload id prevents a duplicate row.
  if (result.ok) return "local";
  if (result.code === "recording_invalid_state") {
    if (result.status === "local" || result.status === "uploading") return result.status;
    if (isDeliveredRecordingStatus(result.status)) return result.status;
  }
  throw new Error(result.code ?? "network_unavailable");
}

async function markUploading(recordingId: string): Promise<"uploading" | DeliveredRecordingStatus> {
  const result = await rpc("mark_recording_uploading", { target_recording: recordingId });
  if (result.ok) return "uploading";
  if (result.code === "recording_invalid_state") {
    if (result.status === "uploading") return "uploading";
    if (isDeliveredRecordingStatus(result.status)) return result.status;
  }
  throw new Error(result.code ?? "network_unavailable");
}

async function requestAutomaticProcessing(recordingId: string): Promise<void> {
  if (!WEB_URL || !supabase) throw new Error("processing_endpoint_unavailable");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authorized");
  const response = await fetch(`${WEB_URL}/api/recordings/${recordingId}/process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const body = (await response.json().catch(() => null)) as { code?: string; error?: { code?: string } } | null;
  const code = body?.error?.code ?? body?.code;
  if (!isProcessingDispatchAccepted(response.ok, response.status, code)) {
    throw new Error(code ?? "processing_failed");
  }
}

async function completeDeliveredItem(
  item: QueueItem,
  remoteStatus: DeliveredRecordingStatus,
  uploadedNow = false,
): Promise<void> {
  if (!item.recordingId) throw new Error("recording_missing");

  let nextState: QueueState = remoteStatus;
  if (item.mode === "ai" && remoteStatus === "uploaded") {
    const uploaded = await updateQueueItem(item.id, {
      state: "uploaded",
      progress: 1,
      errorCode: null,
      leaseUntil: null,
    });
    if (!uploaded) throw new Error("queue_item_missing");
    await requestAutomaticProcessing(item.recordingId);
    nextState = "processing";
  }

  const completed = await updateQueueItem(item.id, {
    state: nextState,
    progress: 1,
    errorCode: null,
    leaseUntil: null,
  });
  if (!completed) throw new Error("queue_item_missing");

  // The remote object is now owned by a processing claim (or is already
  // ready). Only this boundary permits deleting the encrypted local source.
  deleteEncryptedAudio(item.id);
  await Notifications.cancelScheduledNotificationAsync(`pending-${item.id}`).catch(() => undefined);
  if (uploadedNow) trackProductEvent("recording.upload_completed", { mode: item.mode, state: "uploaded" });
}

async function flushItem(original: QueueItem): Promise<void> {
  if (!(await acquireUploadLease(original.id))) return;
  let item = (await getQueueItem(original.id)) ?? original;
  let plainFile: File | null = null;
  try {
    if (!item.recordingId && !(await hasAllEncryptedChunks(item))) {
      await quarantineQueueItem(item.id, "audio_file_missing");
      return;
    }

    item = await ensureRemoteRecording(item);
    if (!item.recordingId) throw new Error("recording_missing");

    const remote = await remoteRecordingState(item.recordingId);
    if (isDeliveredRecordingStatus(remote?.status)) {
      await completeDeliveredItem(item, remote.status);
      return;
    }
    if (item.mode === "ai" && remote?.status === "failed" && remote.audioPath) {
      // Processing failures keep the verified remote object. Reclaim directly;
      // a retry must not require or re-upload an already delivered local file.
      await requestAutomaticProcessing(item.recordingId);
      await completeDeliveredItem(item, "processing");
      return;
    }
    if (!(await hasAllEncryptedChunks(item))) {
      await quarantineQueueItem(item.id, "audio_file_missing");
      return;
    }

    let uploadState: string | null = remote?.status ?? null;
    if (uploadState !== "local" && uploadState !== "uploading") uploadState = await markLocal(item);
    if (isDeliveredRecordingStatus(uploadState)) {
      await completeDeliveredItem(item, uploadState);
      return;
    }
    if (uploadState !== "uploading") uploadState = await markUploading(item.recordingId);
    if (isDeliveredRecordingStatus(uploadState)) {
      await completeDeliveredItem(item, uploadState);
      return;
    }

    plainFile = await createTemporaryPlainFile(item);
    const path = `${item.orgId}/${item.recordingId}.m4a`;
    await uploadWithTus(item, plainFile, path);
    const confirmed = await rpc("confirm_recording_upload", {
      target_recording: item.recordingId,
      target_audio_path: path,
    });
    if (!confirmed.ok) {
      if (confirmed.code === "recording_invalid_state" && isDeliveredRecordingStatus(confirmed.status)) {
        await completeDeliveredItem(item, confirmed.status);
        return;
      }
      throw new Error(confirmed.code ?? "recording_not_uploaded");
    }
    if (!isDeliveredRecordingStatus(confirmed.code)) throw new Error("recording_not_uploaded");
    await completeDeliveredItem(item, confirmed.code, true);
  } catch (error) {
    const code = stableError(error instanceof Error ? error.message : error);
    trackProductEvent("recording.failed", { mode: original.mode, reason_code: code });
    const blocked = ["audio_consent_required", "allowance_unavailable", "not_authorized"].includes(code);
    await updateQueueItem(original.id, {
      state: blocked ? "blocked" : "failed",
      errorCode: code,
      leaseUntil: null,
    }).catch(() => undefined);
  } finally {
    if (plainFile?.exists) plainFile.delete();
  }
}

async function dispatchUploadedItem(item: QueueItem): Promise<void> {
  if (!item.recordingId || item.mode !== "ai") return;
  try {
    const remote = await remoteRecordingState(item.recordingId);
    if (!isDeliveredRecordingStatus(remote?.status)) throw new Error("recording_not_uploaded");
    await completeDeliveredItem(item, remote.status);
  } catch (error) {
    const code = stableError(error instanceof Error ? error.message : error);
    await updateQueueItem(item.id, {
      state: "failed",
      errorCode: code,
      leaseUntil: null,
    }).catch(() => undefined);
  }
}

let activeFlush: Promise<QueueItem[]> | null = null;

async function runFlush(): Promise<QueueItem[]> {
  const items = await readQueue();
  for (const item of items) {
    if (item.state === "local" || item.state === "failed") await flushItem(item);
  }
  await refreshQueueStatuses();
  const delivered = await readQueue();
  for (const item of delivered) {
    if (item.state === "uploaded" && item.mode === "ai") await dispatchUploadedItem(item);
  }
  await refreshQueueStatuses();
  return readQueue();
}

export async function flushQueue(): Promise<QueueItem[]> {
  if (!activeFlush) activeFlush = runFlush().finally(() => (activeFlush = null));
  return activeFlush;
}

export async function refreshQueueStatuses(): Promise<QueueItem[]> {
  if (!supabase) return readQueue();
  const items = await readQueue();
  const tracked = items.filter((item) => item.recordingId && ["uploaded", "processing"].includes(item.state));
  if (tracked.length === 0) return items;

  const ids = tracked.map((item) => item.recordingId as string);
  const { data } = await supabase.from("recordings").select("id,status,error_code").in("id", ids);
  for (const row of data ?? []) {
    const item = tracked.find((candidate) => candidate.recordingId === row.id);
    if (!item) continue;
    if (row.status === "ready") {
      await updateQueueItem(item.id, { state: "ready", errorCode: null, leaseUntil: null });
      deleteEncryptedAudio(item.id);
      await Notifications.cancelScheduledNotificationAsync(`pending-${item.id}`).catch(() => undefined);
      trackProductEvent("recording.processing_completed", { mode: item.mode, state: "ready" });
    } else if (row.status === "failed") {
      await updateQueueItem(item.id, {
        state: "failed",
        errorCode: stableError(row.error_code ?? "processing_failed"),
        leaseUntil: null,
      });
    } else if (row.status === "processing") {
      await updateQueueItem(item.id, { state: "processing", leaseUntil: null });
      deleteEncryptedAudio(item.id);
      await Notifications.cancelScheduledNotificationAsync(`pending-${item.id}`).catch(() => undefined);
    } else if (row.status === "uploaded") {
      await updateQueueItem(item.id, { state: "uploaded", leaseUntil: null });
    }
  }
  return readQueue();
}

export async function enqueueRecording(input: {
  sourceUri: string;
  consultationId: string;
  orgId: string;
  patientId: string;
  durationSeconds: number;
  mode?: RecordingMode;
  clientUploadId?: string;
  recordingId?: string;
  authorizationId?: string;
  authorizationExpiresAt?: string;
  pendingNotification?: { title: string; body: string };
}): Promise<QueueItem> {
  const item = await persistEncryptedRecording({
    ...input,
    mode: input.mode ?? "ai",
    clientUploadId: input.clientUploadId ?? randomUUID(),
  });
  await Notifications.scheduleNotificationAsync({
    identifier: `pending-${item.id}`,
    content: {
      title: input.pendingNotification?.title ?? "MedChina",
      body: input.pendingNotification?.body ?? "MedChina",
      data: { event: "recording_pending" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 60 * 60,
      repeats: false,
      channelId: "clinical-status",
    },
  }).catch(() => undefined);
  return item;
}

export async function retryItem(id: string): Promise<QueueItem[]> {
  await updateQueueItem(id, { state: "local", errorCode: null, leaseUntil: null });
  return flushQueue();
}

export { queueForConsultation, readQueue };
