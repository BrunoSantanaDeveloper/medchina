import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, ScrollView, View } from "react-native";
import { ActivityIndicator, Button, Card, Chip, SegmentedButtons, Text, useTheme } from "react-native-paper";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { File } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Linking from "expo-linking";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useTranslations } from "use-intl";

import NiMicrophone from "@/icons/nexture/ni-microphone";
import { clearActiveCapture, saveActiveCapture, updateActiveCaptureSource } from "@/lib/active-capture";
import {
  getAudioAllowance,
  getConsultation,
  getCurrentOrgId,
  hasPatientConsent,
  type AudioAllowance,
  type TodayConsultation,
} from "@/lib/clinical";
import {
  authorizeCapture,
  completeCaptureAuthorization,
  type CaptureAuthorization,
} from "@/lib/recording-authorization";
import { buildWebHandoff } from "@/lib/mobile-navigation";
import { trackProductEvent } from "@/lib/product-events";
import { enqueueRecording, flushQueue, queueForConsultation, retryItem, type QueueItem } from "@/lib/recording-queue";
import { MAX_RECORDING_SECONDS, RecordingLimitError, type RecordingMode } from "@/lib/recording-store";
import { supabase } from "@/lib/supabase";
import { GRID, RADIUS, TOUCH_TARGET } from "@/theme";

const KEEP_AWAKE_TAG = "medchina-capture";

export default function ConsultationCapture() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTranslations("mobile");
  const theme = useTheme();
  const navigation = useNavigation();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [consultation, setConsultation] = useState<TodayConsultation | null | undefined>(undefined);
  const [audioConsent, setAudioConsent] = useState<boolean | null>(null);
  const [aiConsent, setAiConsent] = useState<boolean | null>(null);
  const [allowance, setAllowance] = useState<AudioAllowance | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [mode, setMode] = useState<RecordingMode>("ai");
  const [authorization, setAuthorization] = useState<CaptureAuthorization | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);

  const refreshQueue = useCallback(async () => setQueue(await queueForConsultation(id)), [id]);

  useEffect(() => {
    const load = async () => {
      const org = await getCurrentOrgId();
      setOrgId(org);
      const row = await getConsultation(id);
      setConsultation(row);
      if (org && row) {
        const [audio, ai, currentAllowance] = await Promise.all([
          hasPatientConsent(org, row.patientId, "audio-recording"),
          hasPatientConsent(org, row.patientId, "ai-processing"),
          getAudioAllowance(org),
        ]);
        setAudioConsent(audio);
        setAiConsent(ai);
        setAllowance(currentAllowance);
      }
      await refreshQueue();
    };
    void load();
  }, [id, refreshQueue]);

  useEffect(() => {
    if (consultation) navigation.setOptions({ title: consultation.patientName });
  }, [consultation, navigation]);

  const recording = recorderState.isRecording || paused;

  // A consultation runs 40–60 min with the phone resting on the table. The
  // device's auto-lock would otherwise fire AppState → finish() and truncate
  // the capture silently (there is no background-audio entitlement, so the mic
  // cannot keep running once suspended). Holding the screen awake while
  // recording removes that failure; deliberate backgrounding still stops and
  // saves (the audio is queued, never lost).
  useEffect(() => {
    if (!recording) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [recording]);

  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (!recording) return;
        event.preventDefault();
        trackProductEvent("recording.interrupted", { mode, state: paused ? "paused" : "recording" });
        Alert.alert(t("capture-leave-title"), t("capture-leave-hint"));
      }),
    [mode, navigation, paused, recording, t],
  );

  const start = async () => {
    if (!orgId || !consultation) return;
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t("capture-mic-denied-title"), t("capture-mic-denied"));
      return;
    }

    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPaused(false);
    setAuthorizing(true);
    const result = await authorizeCapture({ orgId, consultationId: consultation.id, mode });
    setAuthorizing(false);

    if (!result.ok) {
      await recorder.stop().catch(() => undefined);
      if (recorder.uri) {
        const invalid = new File(recorder.uri);
        if (invalid.exists) invalid.delete();
      }
      Alert.alert(t("capture-unavailable-title"), t(`capture-error-${result.code}`));
      return;
    }
    try {
      await saveActiveCapture({
        consultationId: consultation.id,
        orgId,
        patientId: consultation.patientId,
        mode,
        clientUploadId: result.clientUploadId,
        recordingId: result.recordingId,
        authorizationId: result.authorizationId,
        authorizationExpiresAt: result.authorizationExpiresAt,
        startedAt: new Date().toISOString(),
        sourceUri: recorder.uri ?? undefined,
      });
      await completeCaptureAuthorization(result.clientUploadId).catch(() => undefined);
    } catch {
      await recorder.stop().catch(() => undefined);
      if (result.recordingId && supabase) {
        const { data, error } = await supabase.rpc("cancel_clinical_recording", {
          target_recording: result.recordingId,
          target_error_code: "local_recovery_unavailable",
        });
        if (!error && (data as { ok?: boolean } | null)?.ok) {
          await completeCaptureAuthorization(result.clientUploadId).catch(() => undefined);
        }
      }
      Alert.alert(t("capture-unavailable-title"), t("capture-error-generic"));
      return;
    }
    setAuthorization(result);
    void getAudioAllowance(orgId).then(setAllowance);
    trackProductEvent("recording.started", { mode });
  };

  const togglePause = () => {
    if (paused) recorder.record();
    else recorder.pause();
    setPaused((value) => !value);
  };

  const finish = useCallback(async () => {
    if (!orgId || !consultation || !authorization || busy) return;
    setBusy(true);
    try {
      const seconds = Math.max(Math.round(recorderState.durationMillis / 1_000), 1);
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("capture_file_missing");
      await updateActiveCaptureSource(uri);

      await enqueueRecording({
        sourceUri: uri,
        consultationId: consultation.id,
        orgId,
        patientId: consultation.patientId,
        durationSeconds: seconds,
        mode,
        clientUploadId: authorization.clientUploadId,
        recordingId: authorization.recordingId,
        authorizationId: authorization.authorizationId,
        authorizationExpiresAt: authorization.authorizationExpiresAt,
        pendingNotification: { title: "MedChina", body: t("capture-pending-notification") },
      });
      await completeCaptureAuthorization(authorization.clientUploadId).catch(() => undefined);
      await clearActiveCapture();
      setPaused(false);
      setAuthorization(null);
      await refreshQueue();
      await flushQueue().catch(() => undefined);
      await refreshQueue();
    } catch (error) {
      const key = error instanceof RecordingLimitError ? `capture-error-${error.code}` : "capture-error-generic";
      Alert.alert(t("capture-error-title"), t(key));
    } finally {
      setBusy(false);
    }
  }, [authorization, busy, consultation, mode, orgId, recorder, recorderState.durationMillis, refreshQueue, t]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && recording && authorization && !busy) void finish();
    });
    return () => subscription.remove();
  }, [authorization, busy, finish, recording]);

  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis >= MAX_RECORDING_SECONDS * 1_000 && !busy) {
      void finish();
    }
  }, [busy, finish, recorderState.durationMillis, recorderState.isRecording]);

  if (consultation === undefined) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!consultation) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: GRID * 3 }}>
        <Text variant="bodyMedium">{t("capture-not-found")}</Text>
      </View>
    );
  }

  // A primeira captura elegível pode receber no servidor o benefício gratuito
  // operacional. O app não apresenta plano, preço, renovação ou checkout.
  const allowanceBlocked = mode === "ai" && allowance?.canStart === false && allowance.promotionAvailable === false;
  const blocked = audioConsent === false || (mode === "ai" && aiConsent === false) || allowanceBlocked;
  const totalSeconds = Math.floor(recorderState.durationMillis / 1_000);
  const mmss = `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
  const nearLimit = totalSeconds >= MAX_RECORDING_SECONDS - 10 * 60;
  const consentHandoff = buildWebHandoff("consent", { patientId: consultation.patientId });

  const stateLabels: Record<QueueItem["state"], string> = {
    local: t("capture-state-local"),
    authorizing: t("capture-state-authorizing"),
    uploading: t("capture-state-uploading"),
    uploaded: t("capture-state-uploaded"),
    processing: t("capture-state-processing"),
    ready: t("capture-state-ready"),
    failed: t("capture-state-failed"),
    blocked: t("capture-state-blocked"),
    quarantined: t("capture-state-quarantined"),
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: GRID * 2, gap: GRID * 1.5, paddingBottom: GRID * 5 }}
    >
      {consultation.alerts.length > 0 && (
        <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
          <Card.Content style={{ gap: GRID / 2 }}>
            <Text variant="titleSmall">{t("capture-alerts")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID / 2 }}>
              {consultation.alerts.map((alert, index) => (
                <Chip key={index} compact mode="outlined" textStyle={{ fontSize: 11 }}>
                  {alert.label}
                </Chip>
              ))}
            </View>
          </Card.Content>
        </Card>
      )}

      <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
        <Card.Content style={{ gap: GRID }}>
          <Text variant="titleSmall">{t("capture-mode-title")}</Text>
          <SegmentedButtons
            value={mode}
            onValueChange={(value) => setMode(value as RecordingMode)}
            buttons={[
              { value: "ai", label: t("capture-mode-ai"), disabled: recording },
              { value: "audio_only", label: t("capture-mode-audio"), disabled: recording },
            ]}
          />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {mode === "ai" ? t("capture-mode-ai-hint") : t("capture-mode-audio-hint")}
          </Text>
        </Card.Content>
      </Card>

      {audioConsent === false && (
        <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
          <Card.Content style={{ gap: GRID / 2 }}>
            <Text variant="titleSmall">{t("capture-no-consent-title")}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {t("capture-no-consent")}
            </Text>
            {consentHandoff ? (
              <Button mode="text" onPress={() => void Linking.openURL(consentHandoff)}>
                {t("capture-open-consent-web")}
              </Button>
            ) : null}
          </Card.Content>
        </Card>
      )}

      {audioConsent !== false && mode === "ai" && aiConsent === false && (
        <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
          <Card.Content style={{ gap: GRID / 2 }}>
            <Text variant="titleSmall">{t("capture-no-ai-consent-title")}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {t("capture-no-ai-consent")}
            </Text>
            {consentHandoff ? (
              <Button mode="text" onPress={() => void Linking.openURL(consentHandoff)}>
                {t("capture-open-consent-web")}
              </Button>
            ) : null}
          </Card.Content>
        </Card>
      )}

      {audioConsent !== false && allowanceBlocked && (
        <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
          <Card.Content style={{ gap: GRID / 2 }}>
            <Text variant="titleSmall">{t("capture-unavailable-title")}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {t("capture-feature-unavailable")}
            </Text>
          </Card.Content>
        </Card>
      )}

      {!blocked && (
        <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
          <Card.Content style={{ gap: GRID * 1.5, alignItems: "center", paddingVertical: GRID * 3 }}>
            <NiMicrophone size="large" color={recording ? theme.colors.primary : theme.colors.onSurfaceVariant} />
            <Text accessibilityLiveRegion="polite" variant="displaySmall" style={{ fontVariant: ["tabular-nums"] }}>
              {mmss}
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {authorizing
                ? t("capture-authorizing")
                : recording
                  ? paused
                    ? t("capture-paused")
                    : t("capture-recording")
                  : t("capture-idle")}
            </Text>

            {!recording ? (
              <Button
                mode="contained"
                onPress={start}
                disabled={busy || authorizing}
                contentStyle={{ height: TOUCH_TARGET + 8, paddingHorizontal: GRID * 3 }}
              >
                {t("capture-start")}
              </Button>
            ) : (
              <View style={{ flexDirection: "row", gap: GRID }}>
                <Button
                  mode="outlined"
                  onPress={togglePause}
                  disabled={authorizing}
                  contentStyle={{ height: TOUCH_TARGET }}
                >
                  {paused ? t("capture-resume") : t("capture-pause")}
                </Button>
                <Button
                  mode="contained"
                  onPress={() => void finish()}
                  loading={busy}
                  disabled={busy || authorizing || !authorization}
                  contentStyle={{ height: TOUCH_TARGET }}
                >
                  {t("capture-finish")}
                </Button>
              </View>
            )}

            {recording ? (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}>
                {t("capture-screen-on-hint")}
              </Text>
            ) : null}
            {nearLimit && recording ? (
              <Text
                accessibilityLiveRegion="polite"
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                {t("capture-limit-warning")}
              </Text>
            ) : null}
            {mode === "ai" && allowance?.canStart && allowance.minutesRemaining > 0 ? (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t("capture-minutes-left", { minutes: allowance.minutesRemaining })}
              </Text>
            ) : null}
          </Card.Content>
        </Card>
      )}

      {queue.length > 0 && (
        <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
          <Card.Content style={{ gap: GRID }}>
            <Text variant="titleSmall">{t("capture-queue")}</Text>
            {queue.map((item) => (
              <View key={item.id} style={{ gap: GRID / 2 }}>
                <View
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: GRID }}
                >
                  <Text variant="bodyMedium">
                    {new Date(item.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {Math.max(1, Math.round(item.durationSeconds / 60))} min
                  </Text>
                  <Chip compact mode="flat" textStyle={{ fontSize: 11 }}>
                    {stateLabels[item.state]}
                  </Chip>
                </View>
                {item.state === "uploading" ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    {t("capture-upload-progress", { progress: Math.round(item.progress * 100) })}
                  </Text>
                ) : null}
                {["blocked", "failed"].includes(item.state) ? (
                  <View style={{ gap: GRID / 2 }}>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {item.state === "blocked" ? t("capture-blocked-kept") : t("capture-failed-kept")}
                    </Text>
                    <Button compact mode="text" onPress={async () => setQueue(await retryItem(item.id))}>
                      {t("capture-retry")}
                    </Button>
                  </View>
                ) : null}
                {item.state === "quarantined" ? (
                  <Text accessibilityLiveRegion="polite" variant="bodySmall" style={{ color: theme.colors.error }}>
                    {t("capture-quarantined")}
                  </Text>
                ) : null}
              </View>
            ))}
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {t("capture-queue-note")}
            </Text>
          </Card.Content>
        </Card>
      )}
    </ScrollView>
  );
}
