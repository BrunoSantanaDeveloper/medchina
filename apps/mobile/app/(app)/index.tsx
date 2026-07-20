import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { ActivityIndicator, Banner, Card, Chip, Text, useTheme } from "react-native-paper";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslations } from "use-intl";

import { QueueItemRow } from "@/components/queue-item-row";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import { getCurrentOrgId, listTodayConsultations, type TodayConsultation } from "@/lib/clinical";
import { flushQueue, readQueue, retryItem, type QueueItem } from "@/lib/recording-queue";
import { isAwaitingDelivery, needsAttention } from "@/lib/recording-state";
import { isSupabaseConfigured } from "@/lib/supabase";
import { GRID, RADIUS, TOUCH_TARGET } from "@/theme";

type DayState = {
  consultations: TodayConsultation[];
  offline: boolean;
  cachedAt: string | null;
};

/**
 * The app's home: TODAY'S CONSULTATIONS (PRD §11, HOME-SPEC §15.7).
 *
 * The job is one thing — see who is coming and start capturing — so the screen
 * is a short, tappable list of the day, not a dashboard. The agenda that fills
 * it lives on the web (PRD §9.3); this app captures.
 *
 * Every visit also nudges the upload queue: a consultation recorded in a room
 * with bad signal gets sent as soon as the phone can, without her doing
 * anything (PRD §11). Recordings that STOPPED are pulled up here from any day —
 * a failure from yesterday must not be buried inside yesterday's consultation.
 */
export default function Today() {
  const t = useTranslations("mobile");
  const theme = useTheme();
  const router = useRouter();
  const [day, setDay] = useState<DayState | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setDay({ consultations: [], offline: false, cachedAt: null });
      return;
    }
    const orgId = await getCurrentOrgId();
    setDay(orgId ? await listTodayConsultations(orgId) : { consultations: [], offline: false, cachedAt: null });
    // Best effort: never block the list on the network.
    setQueue(await flushQueue().catch(() => readQueue()));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const time = (value: string) =>
    new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const awaiting = queue.filter((item) => isAwaitingDelivery(item.state));
  const stuck = queue.filter((item) => needsAttention(item.state));

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: GRID * 2, gap: GRID * 1.5, paddingBottom: GRID * 6 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Honest about audio still on the phone (HOME-SPEC §15.5). */}
      {awaiting.length > 0 && (
        <Banner visible icon="upload" style={{ borderRadius: RADIUS.xl, borderCurve: "continuous" }}>
          {t("today-pending", { count: awaiting.length })}
        </Banner>
      )}

      {/* Stopped recordings, from any day — the only queue items that need her. */}
      {stuck.length > 0 && (
        <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
          <Card.Content style={{ gap: GRID }}>
            <Text variant="titleSmall">{t("deliveries-title")}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {t("deliveries-hint")}
            </Text>
            {stuck.map((item) => (
              <QueueItemRow
                key={item.id}
                item={item}
                onRetry={async (id) => setQueue(await retryItem(id))}
                onOpenConsultation={(consultationId) => router.push(`/consulta/${consultationId}`)}
              />
            ))}
          </Card.Content>
        </Card>
      )}

      {day?.offline && day.cachedAt ? (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {t("today-offline-cached", { time: time(day.cachedAt) })}
        </Text>
      ) : null}

      {!day ? (
        <View style={{ paddingVertical: GRID * 6, alignItems: "center" }}>
          <ActivityIndicator />
        </View>
      ) : day.offline && day.consultations.length === 0 ? (
        // A day we could not read is NOT an empty day.
        <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
          <Card.Content style={{ gap: GRID, alignItems: "center", paddingVertical: GRID * 4 }}>
            <Text variant="titleMedium">{t("today-offline-title")}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}>
              {t("today-offline-hint")}
            </Text>
          </Card.Content>
        </Card>
      ) : day.consultations.length === 0 ? (
        <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
          <Card.Content style={{ gap: GRID, alignItems: "center", paddingVertical: GRID * 4 }}>
            <NiCalendarClock size="large" color={theme.colors.primary} />
            <Text variant="titleMedium">{t("today-empty-title")}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}>
              {t("today-empty-hint")}
            </Text>
          </Card.Content>
        </Card>
      ) : (
        day.consultations.map((consultation) => (
          <Card
            key={consultation.id}
            mode="outlined"
            onPress={() => router.push(`/consulta/${consultation.id}`)}
            style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous", minHeight: TOUCH_TARGET * 1.6 }}
          >
            <Card.Content style={{ gap: GRID / 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: GRID }}>
                <Text variant="titleMedium" style={{ fontVariant: ["tabular-nums"] }}>
                  {time(consultation.startedAt)}
                </Text>
                {consultation.status === "in_progress" && (
                  <Chip compact mode="flat" textStyle={{ fontSize: 11 }}>
                    {t("today-in-progress")}
                  </Chip>
                )}
              </View>
              <Text variant="bodyLarge">{consultation.patientName}</Text>
              {consultation.reason ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {consultation.reason}
                </Text>
              ) : null}
              {/* Clinical alerts belong BEFORE the consultation, not buried. */}
              {consultation.alerts.length > 0 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID / 2, marginTop: GRID / 2 }}>
                  {consultation.alerts.map((alert, index) => (
                    <Chip key={index} compact mode="outlined" textStyle={{ fontSize: 11 }}>
                      {alert.label}
                    </Chip>
                  ))}
                </View>
              )}
            </Card.Content>
          </Card>
        ))
      )}
    </ScrollView>
  );
}
