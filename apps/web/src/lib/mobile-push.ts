import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type PushKind = "recording_ready" | "recording_failed";
type PushLocale = "pt-BR" | "en" | "es" | "fr" | "de";

const COPY: Record<PushLocale, Record<PushKind, string>> = {
  "pt-BR": {
    recording_ready: "Uma consulta está pronta para revisão.",
    recording_failed: "Não foi possível concluir um processamento.",
  },
  en: {
    recording_ready: "A consultation is ready for review.",
    recording_failed: "A processing task could not be completed.",
  },
  es: {
    recording_ready: "Una consulta está lista para revisión.",
    recording_failed: "No se pudo completar un procesamiento.",
  },
  fr: {
    recording_ready: "Une consultation est prête à être vérifiée.",
    recording_failed: "Un traitement n'a pas pu être terminé.",
  },
  de: {
    recording_ready: "Eine Konsultation kann jetzt geprüft werden.",
    recording_failed: "Eine Verarbeitung konnte nicht abgeschlossen werden.",
  },
};

/**
 * Sends only generic operational status. Patient names, complaints, patterns,
 * transcript excerpts and every other clinical field are deliberately absent.
 */
export async function sendMobileStatusPush(
  service: SupabaseClient,
  input: { orgId: string; consultationId: string; kind: PushKind },
): Promise<boolean> {
  const { data } = await service
    .from("mobile_devices")
    .select("expo_push_token, locale")
    .eq("org_id", input.orgId)
    .eq("enabled", true);
  const devices = [
    ...new Map(
      (data ?? [])
        .filter((row) => Boolean(row.expo_push_token))
        .map((row) => [row.expo_push_token as string, row] as const),
    ).values(),
  ];
  if (devices.length === 0) return true;

  const messages = devices.map((device) => ({
    to: device.expo_push_token as string,
    sound: "default",
    title: "MedChina",
    body: COPY[(device.locale as PushLocale) in COPY ? (device.locale as PushLocale) : "pt-BR"][input.kind],
    channelId: "clinical-status",
    data: { consultationId: input.consultationId, event: input.kind },
  }));

  let delivered = true;
  for (let offset = 0; offset < messages.length; offset += 100) {
    try {
      const batch = messages.slice(offset, offset + 100);
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        delivered = false;
        continue;
      }
      const payload = (await response.json().catch(() => null)) as {
        data?: { status?: string; details?: { error?: string } }[];
      } | null;
      if (!Array.isArray(payload?.data)) {
        delivered = false;
        continue;
      }
      for (let index = 0; index < batch.length; index += 1) {
        const ticket = payload.data[index];
        if (ticket?.status !== "error") continue;
        if (ticket.details?.error === "DeviceNotRegistered") {
          await service.from("mobile_devices").update({ enabled: false }).eq("expo_push_token", batch[index].to);
        } else {
          delivered = false;
        }
      }
    } catch {
      delivered = false;
    }
  }
  return delivered;
}

/** Claim once, then deliver the same PHI-free state to the bell and devices. */
export async function notifyRecordingStatus(
  service: SupabaseClient,
  recordingId: string,
  kind: PushKind,
): Promise<void> {
  const { data } = await service.rpc("claim_recording_status_notification", {
    target_recording: recordingId,
    target_kind: kind,
  });
  const claim = data as {
    ok?: boolean;
    outboxId?: string;
    claimToken?: string;
    orgId?: string;
    consultationId?: string;
    userId?: string;
  } | null;
  if (!claim?.ok || !claim.outboxId || !claim.claimToken || !claim.orgId || !claim.consultationId) {
    return;
  }

  const pushDelivered = await sendMobileStatusPush(service, {
    orgId: claim.orgId,
    consultationId: claim.consultationId,
    kind,
  });
  let inAppDelivered = true;
  if (claim.userId) {
    const { error } = await service.from("notifications").insert({
      user_id: claim.userId,
      type: "clinical",
      title: "MedChina",
      body: COPY["pt-BR"][kind],
      href: `/consultas/${claim.consultationId}`,
      source_key: `recording:${recordingId}:${kind}`,
    });
    inAppDelivered = !error || error.code === "23505";
  }
  await service.rpc("complete_recording_status_notification", {
    target_outbox: claim.outboxId,
    target_claim_token: claim.claimToken,
    target_success: pushDelivered && inAppDelivered,
    target_error_code: pushDelivered ? "in_app_delivery_failed" : "push_delivery_failed",
  });
}
