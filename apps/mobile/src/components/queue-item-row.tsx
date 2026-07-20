import { View } from "react-native";
import { Button, Chip, Text, useTheme } from "react-native-paper";
import { useTranslations } from "use-intl";

import type { QueueItem } from "@/lib/recording-queue";
import { canRetryQueueItem, needsAttention } from "@/lib/recording-state";
import { GRID, TOUCH_TARGET } from "@/theme";

/**
 * One recording in the delivery queue, said out loud: where the audio is, what
 * is holding it, and the one action that moves it. Shared by the day's list and
 * Modo Consulta so both screens can never describe the same item differently.
 */
export function QueueItemRow({
  item,
  onRetry,
  onOpenConsultation,
}: {
  item: QueueItem;
  onRetry?: (id: string) => void;
  onOpenConsultation?: (consultationId: string) => void;
}) {
  const t = useTranslations("mobile");
  const theme = useTheme();

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

  const time = new Date(item.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const minutes = Math.max(1, Math.round(item.durationSeconds / 60));

  return (
    <View style={{ gap: GRID / 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: GRID }}>
        <Text variant="bodyMedium">
          {time} · {t("delivery-minutes", { minutes })}
        </Text>
        <Chip compact mode="flat" textStyle={{ fontSize: 11 }}>
          {stateLabels[item.state]}
        </Chip>
      </View>

      {item.state === "uploading" ? (
        <Text accessibilityLiveRegion="polite" variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {t("capture-upload-progress", { progress: Math.round(item.progress * 100) })}
        </Text>
      ) : null}

      {needsAttention(item.state) ? (
        <Text
          accessibilityLiveRegion="polite"
          variant="bodySmall"
          style={{ color: item.state === "quarantined" ? theme.colors.error : theme.colors.onSurfaceVariant }}
        >
          {item.state === "blocked"
            ? t("capture-blocked-kept")
            : item.state === "quarantined"
              ? t("capture-quarantined")
              : t("capture-failed-kept")}
        </Text>
      ) : null}

      {(onRetry && canRetryQueueItem(item.state) && item.state !== "local") || onOpenConsultation ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID }}>
          {onRetry && canRetryQueueItem(item.state) && item.state !== "local" ? (
            <Button compact mode="text" onPress={() => onRetry(item.id)} contentStyle={{ minHeight: TOUCH_TARGET }}>
              {t("capture-retry")}
            </Button>
          ) : null}
          {onOpenConsultation ? (
            <Button
              compact
              mode="text"
              onPress={() => onOpenConsultation(item.consultationId)}
              contentStyle={{ minHeight: TOUCH_TARGET }}
            >
              {t("delivery-open-consultation")}
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
