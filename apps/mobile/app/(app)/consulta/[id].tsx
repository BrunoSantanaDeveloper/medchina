import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { ActivityIndicator, Button, Card, Chip, Text, useTheme } from "react-native-paper";
import { useLocalSearchParams, useNavigation } from "expo-router";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useTranslations } from "use-intl";

import NiMicrophone from "@/icons/nexture/ni-microphone";
import {
  getAudioAllowance,
  getConsultation,
  getCurrentOrgId,
  hasRecordingConsent,
  type AudioAllowance,
  type TodayConsultation,
} from "@/lib/clinical";
import { enqueueRecording, flushQueue, queueForConsultation, retryItem, type QueueItem } from "@/lib/recording-queue";
import { GRID, RADIUS, TOUCH_TARGET } from "@/theme";

/**
 * Modo Consulta on the phone (PRD §11): the practitioner puts the phone down and
 * looks at the patient. So the screen is deliberately sparse — who is in front
 * of her, what she must know before touching them (alerts), and one big control
 * in the thumb zone.
 *
 * Two gates, both verified against the database rather than assumed:
 *  - CONSENT (PRD §9.5). The app only verifies it; granting is a deliberate act
 *    on the web with the patient present and the versioned term shown;
 *  - ALLOWANCE (PRD §5.7/§5.8). If there are no minutes, the app says so and
 *    points to the web. It NEVER starts a trial and never sells — plans and
 *    payment are web-only (PRD §4.4, store policy).
 *
 * Recording is never lost: the moment it stops, the audio goes to persistent
 * storage and into the queue (lib/recording-queue).
 */
export default function Consulta() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTranslations("mobile");
  const theme = useTheme();
  const navigation = useNavigation();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [consultation, setConsultation] = useState<TodayConsultation | null | undefined>(undefined);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [allowance, setAllowance] = useState<AudioAllowance | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshQueue = useCallback(async () => setQueue(await queueForConsultation(id)), [id]);

  useEffect(() => {
    const load = async () => {
      const org = await getCurrentOrgId();
      setOrgId(org);
      const row = await getConsultation(id);
      setConsultation(row);
      if (org && row) {
        setConsent(await hasRecordingConsent(org, row.patientId));
        setAllowance(await getAudioAllowance(org));
      }
      await refreshQueue();
    };
    load();
  }, [id, refreshQueue]);

  // The header names the patient in front of her.
  useEffect(() => {
    if (consultation) navigation.setOptions({ title: consultation.patientName });
  }, [consultation, navigation]);

  const start = async () => {
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t("capture-mic-denied-title"), t("capture-mic-denied"));
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPaused(false);
  };

  const togglePause = () => {
    if (paused) {
      recorder.record();
      setPaused(false);
    } else {
      recorder.pause();
      setPaused(true);
    }
  };

  const finish = async () => {
    if (!orgId || !consultation) return;
    setBusy(true);
    try {
      const seconds = Math.max(Math.round(recorderState.durationMillis / 1000), 1);
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("no uri");

      // Persist FIRST, send second — a dropped connection must never cost a
      // consultation (PRD §11).
      await enqueueRecording({
        sourceUri: uri,
        consultationId: consultation.id,
        orgId,
        patientId: consultation.patientId,
        durationSeconds: seconds,
      });
      setPaused(false);
      await refreshQueue();
      await flushQueue().catch(() => undefined);
      await refreshQueue();
    } catch (error) {
      Alert.alert(t("capture-error-title"), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const mmss = (() => {
    const total = Math.floor(recorderState.durationMillis / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  })();

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

  const recording = recorderState.isRecording || paused;
  const blocked = consent === false || allowance?.canStart === false;

  const stateLabel = (item: QueueItem) =>
    ({
      local: t("capture-state-local"),
      uploading: t("capture-state-uploading"),
      uploaded: t("capture-state-uploaded"),
      blocked: t("capture-state-blocked"),
    })[item.state];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: GRID * 2, gap: GRID * 1.5, paddingBottom: GRID * 4 }}
    >
        {/* What she must know before touching the patient. */}
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

        {/* Consent gate — verified, never granted here (PRD §9.5). */}
        {consent === false && (
          <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
            <Card.Content style={{ gap: GRID / 2 }}>
              <Text variant="titleSmall">{t("capture-no-consent-title")}</Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {t("capture-no-consent")}
              </Text>
            </Card.Content>
          </Card>
        )}

        {/* Allowance gate — the app states the fact and stops. No selling here. */}
        {consent !== false && allowance?.canStart === false && (
          <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
            <Card.Content style={{ gap: GRID / 2 }}>
              <Text variant="titleSmall">{t("capture-no-allowance-title")}</Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {allowance.trialAvailable ? t("capture-trial-on-web") : t("capture-no-minutes")}
              </Text>
            </Card.Content>
          </Card>
        )}

        {/* The one control that matters, big and reachable. */}
        {!blocked && (
          <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
            <Card.Content style={{ gap: GRID * 1.5, alignItems: "center", paddingVertical: GRID * 3 }}>
              <NiMicrophone size="large" color={recording ? theme.colors.primary : theme.colors.onSurfaceVariant} />
              <Text variant="displaySmall" style={{ fontVariant: ["tabular-nums"] }}>
                {mmss}
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {recording ? (paused ? t("capture-paused") : t("capture-recording")) : t("capture-idle")}
              </Text>

              {!recording ? (
                <Button
                  mode="contained"
                  onPress={start}
                  disabled={busy}
                  contentStyle={{ height: TOUCH_TARGET + 8, paddingHorizontal: GRID * 3 }}
                >
                  {t("capture-start")}
                </Button>
              ) : (
                <View style={{ flexDirection: "row", gap: GRID }}>
                  <Button mode="outlined" onPress={togglePause} contentStyle={{ height: TOUCH_TARGET }}>
                    {paused ? t("capture-resume") : t("capture-pause")}
                  </Button>
                  <Button mode="contained" onPress={finish} loading={busy} disabled={busy} contentStyle={{ height: TOUCH_TARGET }}>
                    {t("capture-finish")}
                  </Button>
                </View>
              )}

              {allowance && allowance.canStart && allowance.minutesRemaining > 0 && (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t("capture-minutes-left", { minutes: allowance.minutesRemaining })}
                </Text>
              )}
            </Card.Content>
          </Card>
        )}

        {/* Where each recording actually is — phone, in flight, or confirmed. */}
        {queue.length > 0 && (
          <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
            <Card.Content style={{ gap: GRID }}>
              <Text variant="titleSmall">{t("capture-queue")}</Text>
              {queue.map((item) => (
                <View key={item.id} style={{ gap: GRID / 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text variant="bodyMedium">
                      {new Date(item.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} ·{" "}
                      {Math.round(item.durationSeconds / 60)} min
                    </Text>
                    <Chip compact mode="flat" textStyle={{ fontSize: 11 }}>
                      {stateLabel(item)}
                    </Chip>
                  </View>
                  {item.state === "blocked" && (
                    <View style={{ gap: GRID / 2 }}>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {t("capture-blocked-kept")}
                      </Text>
                      <Button
                        compact
                        mode="text"
                        onPress={async () => {
                          setQueue(await retryItem(item.id));
                        }}
                      >
                        {t("capture-retry")}
                      </Button>
                    </View>
                  )}
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
