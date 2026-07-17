import * as Notifications from "expo-notifications";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { useTranslations } from "use-intl";

import { captureRuntimeId, clearActiveCapture, readActiveCapture } from "@/lib/active-capture";
import { isUuid } from "@/lib/mobile-navigation";
import { useRecordingDelivery } from "@/lib/delivery-background";
import { completeCaptureAuthorization } from "@/lib/recording-authorization";
import { enqueueRecording, flushQueue } from "@/lib/recording-queue";
import { MAX_RECORDING_SECONDS, persistQuarantinedRecording } from "@/lib/recording-store";
import { trackProductEvent } from "@/lib/product-events";
import { useSession } from "@/providers/session";

export function DeliveryProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const t = useTranslations("mobile");
  const { session, needsMfa, localUnlocked, setPendingPath } = useSession();
  useRecordingDelivery();

  useEffect(() => {
    let active = true;
    const recover = async () => {
      const capture = await readActiveCapture();
      if (!active || !capture || capture.runtimeId === captureRuntimeId) return;
      const elapsed = Math.max(
        1,
        Math.min(Math.round((Date.now() - new Date(capture.startedAt).getTime()) / 1_000), MAX_RECORDING_SECONDS),
      );
      const source = capture.sourceUri ? new File(capture.sourceUri) : null;
      if (source?.exists) {
        await enqueueRecording({
          sourceUri: source.uri,
          consultationId: capture.consultationId,
          orgId: capture.orgId,
          patientId: capture.patientId,
          durationSeconds: elapsed,
          mode: capture.mode,
          clientUploadId: capture.clientUploadId,
          recordingId: capture.recordingId,
          authorizationId: capture.authorizationId,
          authorizationExpiresAt: capture.authorizationExpiresAt,
          pendingNotification: { title: "MedChina", body: t("capture-pending-notification") },
        });
        trackProductEvent("recording.recovered", { mode: capture.mode, state: "recovered" });
      } else {
        await persistQuarantinedRecording({
          consultationId: capture.consultationId,
          orgId: capture.orgId,
          patientId: capture.patientId,
          mode: capture.mode,
          clientUploadId: capture.clientUploadId,
          recordingId: capture.recordingId,
          authorizationId: capture.authorizationId,
          authorizationExpiresAt: capture.authorizationExpiresAt,
          durationSeconds: elapsed,
          errorCode: "audio_file_missing",
        });
        trackProductEvent("recording.interrupted", { mode: capture.mode, state: "failed" });
      }
      await completeCaptureAuthorization(capture.clientUploadId).catch(() => undefined);
      await clearActiveCapture();
      await flushQueue().catch(() => undefined);
    };
    void recover().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    const route = (response: Notifications.NotificationResponse | null) => {
      const value = response?.notification.request.content.data?.consultationId;
      if (!isUuid(typeof value === "string" ? value : null)) return;
      const destination = `/consulta/${value}` as const;
      if (!session || needsMfa || !localUnlocked) void setPendingPath(destination);
      else router.push(destination);
    };
    void Notifications.getLastNotificationResponseAsync().then(route);
    const listener = Notifications.addNotificationResponseReceivedListener(route);
    return () => listener.remove();
  }, [localUnlocked, needsMfa, router, session, setPendingPath]);

  return children;
}
