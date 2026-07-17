import { randomUUID } from "expo-crypto";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";

import { supabase } from "@/lib/supabase";
import type { RecordingMode } from "@/lib/recording-store";

const CACHE_KEY = "medchina.capture-authorization.v3";
const PENDING_REQUESTS_KEY = "medchina.capture-request.v1";

type PendingCaptureRequest = {
  orgId: string;
  consultationId: string;
  mode: RecordingMode;
  clientUploadId: string;
  createdAt: string;
};

type CachedAuthorization = {
  orgId: string;
  consultationId: string;
  authorizationId: string;
  authorizedFromAt: string;
  expiresAt: string;
  aiAuthorized: boolean;
};

export type CaptureAuthorization = {
  ok: true;
  online: boolean;
  clientUploadId: string;
  recordingId?: string;
  authorizationId: string;
  authorizationFromAt: string;
  authorizationExpiresAt: string;
};

export type CaptureAuthorizationFailure = {
  ok: false;
  code:
    | "first_capture_requires_connection"
    | "audio_consent_required"
    | "ai_consent_required"
    | "allowance_unavailable"
    | "recording_pending"
    | "invalid_consultation_transition"
    | "network_unavailable"
    | "not_authorized";
};

function normalizeCode(value: unknown): CaptureAuthorizationFailure["code"] {
  switch (value) {
    case "consent_required":
    case "consent_acceptance_mismatch":
    case "audio_consent_required":
      return "audio_consent_required";
    case "ai_consent_required":
      return "ai_consent_required";
    case "audio_allowance_exhausted":
    case "trial_not_started":
    case "allowance_unavailable":
      return "allowance_unavailable";
    case "recording_already_open":
    case "recording_pending":
      return "recording_pending";
    case "invalid_consultation_transition":
    case "active_consultation_exists":
      return "invalid_consultation_transition";
    case "not_authorized":
      return "not_authorized";
    default:
      return "network_unavailable";
  }
}

async function readPendingRequests(): Promise<PendingCaptureRequest[]> {
  const raw = await SecureStore.getItemAsync(PENDING_REQUESTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PendingCaptureRequest[];
    return (Array.isArray(parsed) ? parsed : []).filter(
      (request) =>
        Boolean(request.orgId) &&
        Boolean(request.consultationId) &&
        Boolean(request.clientUploadId) &&
        Boolean(request.createdAt) &&
        ["ai", "audio_only"].includes(request.mode),
    );
  } catch {
    await SecureStore.deleteItemAsync(PENDING_REQUESTS_KEY);
    return [];
  }
}

async function pendingClientUploadId(input: {
  orgId: string;
  consultationId: string;
  mode: RecordingMode;
}): Promise<string> {
  const requests = await readPendingRequests();
  const existing = requests.find(
    (request) =>
      request.orgId === input.orgId && request.consultationId === input.consultationId && request.mode === input.mode,
  );
  if (existing) return existing.clientUploadId;

  const request: PendingCaptureRequest = {
    ...input,
    clientUploadId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(PENDING_REQUESTS_KEY, JSON.stringify([...requests, request]));
  return request.clientUploadId;
}

/**
 * Consume the durable request id only after the active capture or encrypted
 * queue item has been persisted. Until then a lost RPC response must retry the
 * exact same server idempotency key.
 */
export async function completeCaptureAuthorization(clientUploadId: string): Promise<void> {
  const requests = await readPendingRequests();
  const remaining = requests.filter((request) => request.clientUploadId !== clientUploadId);
  if (remaining.length === requests.length) return;
  if (remaining.length === 0) await SecureStore.deleteItemAsync(PENDING_REQUESTS_KEY);
  else await SecureStore.setItemAsync(PENDING_REQUESTS_KEY, JSON.stringify(remaining));
}

async function readCachedAuthorizations(): Promise<CachedAuthorization[]> {
  const raw = await SecureStore.getItemAsync(CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CachedAuthorization[];
    const usable = (Array.isArray(parsed) ? parsed : []).filter(
      (cached) =>
        Boolean(cached.authorizedFromAt) &&
        new Date(cached.authorizedFromAt).getTime() <= Date.now() + 60_000 &&
        new Date(cached.expiresAt).getTime() > Date.now(),
    );
    if (usable.length !== parsed.length) await cacheAuthorizations(usable);
    return usable;
  } catch {
    await SecureStore.deleteItemAsync(CACHE_KEY);
    return [];
  }
}

async function cacheAuthorizations(input: CachedAuthorization[]): Promise<void> {
  await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(input.slice(-24)), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function cacheAuthorization(input: CachedAuthorization): Promise<void> {
  const current = await readCachedAuthorizations();
  await cacheAuthorizations([
    ...current.filter((cached) => !(cached.orgId === input.orgId && cached.consultationId === input.consultationId)),
    input,
  ]);
}

export async function authorizeCapture(input: {
  orgId: string;
  consultationId: string;
  mode: RecordingMode;
}): Promise<CaptureAuthorization | CaptureAuthorizationFailure> {
  // Persist before the network call. If the server commits but its response is
  // lost, the next attempt reaches the existing row instead of opening a new
  // recording and colliding with it.
  const clientUploadId = await pendingClientUploadId(input);
  const network = await Network.getNetworkStateAsync();
  const online = Boolean(network.isConnected && network.isInternetReachable !== false);

  if (!online || !supabase) {
    const cached = (await readCachedAuthorizations()).find(
      (candidate) => candidate.orgId === input.orgId && candidate.consultationId === input.consultationId,
    );
    const usable = Boolean(cached && (input.mode === "audio_only" || cached.aiAuthorized));
    if (!usable || !cached) return { ok: false, code: "first_capture_requires_connection" };
    await cacheAuthorizations(
      (await readCachedAuthorizations()).filter(
        (candidate) => !(candidate.orgId === input.orgId && candidate.consultationId === input.consultationId),
      ),
    );
    return {
      ok: true,
      online: false,
      clientUploadId,
      authorizationId: cached.authorizationId,
      authorizationFromAt: cached.authorizedFromAt,
      authorizationExpiresAt: cached.expiresAt,
    };
  }

  const { data, error } = await supabase.rpc("authorize_mobile_recording", {
    target_consultation: input.consultationId,
    target_mode: input.mode,
    target_client_upload_id: clientUploadId,
  });
  if (error || !data) return { ok: false, code: normalizeCode(error?.message) };

  const result = data as {
    ok?: boolean;
    code?: string;
    recordingId?: string;
    authorizationId?: string;
    authorizationFromAt?: string;
    authorizationExpiresAt?: string;
    authorizations?: Array<{
      consultationId?: string;
      authorizationId?: string;
      authorizationFromAt?: string;
      authorizationExpiresAt?: string;
      aiAuthorized?: boolean;
    }>;
  };
  if (
    !result.ok ||
    !result.recordingId ||
    !result.authorizationId ||
    !result.authorizationFromAt ||
    !result.authorizationExpiresAt
  ) {
    return { ok: false, code: normalizeCode(result.code) };
  }

  for (const grant of result.authorizations ?? []) {
    if (!grant.consultationId || !grant.authorizationId || !grant.authorizationFromAt || !grant.authorizationExpiresAt)
      continue;
    await cacheAuthorization({
      orgId: input.orgId,
      consultationId: grant.consultationId,
      authorizationId: grant.authorizationId,
      authorizedFromAt: grant.authorizationFromAt,
      expiresAt: grant.authorizationExpiresAt,
      aiAuthorized: Boolean(grant.aiAuthorized),
    });
  }

  return {
    ok: true,
    online: true,
    clientUploadId,
    recordingId: result.recordingId,
    authorizationId: result.authorizationId,
    authorizationFromAt: result.authorizationFromAt,
    authorizationExpiresAt: result.authorizationExpiresAt,
  };
}

export async function clearCaptureAuthorization(): Promise<void> {
  await SecureStore.deleteItemAsync(CACHE_KEY);
}
