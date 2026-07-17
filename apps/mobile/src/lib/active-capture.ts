import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";

import type { RecordingMode } from "@/lib/recording-store";

const ACTIVE_CAPTURE_KEY = "medchina.active-capture.v1";
export const captureRuntimeId = randomUUID();

export type ActiveCapture = {
  version: 1;
  runtimeId: string;
  consultationId: string;
  orgId: string;
  patientId: string;
  mode: RecordingMode;
  clientUploadId: string;
  recordingId?: string;
  authorizationId?: string;
  authorizationExpiresAt?: string;
  startedAt: string;
  sourceUri?: string;
};

export async function saveActiveCapture(capture: Omit<ActiveCapture, "version" | "runtimeId">): Promise<void> {
  await SecureStore.setItemAsync(
    ACTIVE_CAPTURE_KEY,
    JSON.stringify({ version: 1, runtimeId: captureRuntimeId, ...capture }),
  );
}

export async function updateActiveCaptureSource(sourceUri: string): Promise<void> {
  const capture = await readActiveCapture();
  if (!capture) return;
  await SecureStore.setItemAsync(ACTIVE_CAPTURE_KEY, JSON.stringify({ ...capture, sourceUri }));
}

export async function readActiveCapture(): Promise<ActiveCapture | null> {
  const raw = await SecureStore.getItemAsync(ACTIVE_CAPTURE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ActiveCapture>;
    if (
      value.version !== 1 ||
      !value.runtimeId ||
      !value.consultationId ||
      !value.orgId ||
      !value.patientId ||
      !value.clientUploadId ||
      !value.startedAt ||
      !["ai", "audio_only"].includes(value.mode ?? "")
    ) {
      await clearActiveCapture();
      return null;
    }
    return value as ActiveCapture;
  } catch {
    await clearActiveCapture();
    return null;
  }
}

export async function clearActiveCapture(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_CAPTURE_KEY);
}
