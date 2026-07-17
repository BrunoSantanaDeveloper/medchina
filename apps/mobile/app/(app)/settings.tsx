import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Button, List, SegmentedButtons, Switch, Text, useTheme } from "react-native-paper";
import { useTranslations } from "use-intl";

import { LOCALES, type LocaleOption } from "@/config";
import NiCheck from "@/icons/nexture/ni-check";
import NiMessages from "@/icons/nexture/ni-messages";
import NiMoon from "@/icons/nexture/ni-moon";
import NiPower from "@/icons/nexture/ni-power";
import { getCurrentOrgId } from "@/lib/clinical";
import { disablePushNotifications, hasRegisteredPushToken, registerPushNotifications } from "@/lib/push-notifications";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { GRID, TOUCH_TARGET } from "@/theme";

export default function Settings() {
  const t = useTranslations("mobile");
  const tDashboard = useTranslations("dashboard");
  const theme = useTheme();
  const { modeSetting, locale, setModeSetting, setLocale } = useSettings();
  const {
    session,
    isSupabaseConfigured,
    signOut,
    biometricEnabled,
    setBiometricEnabled,
  } = useSession();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([getCurrentOrgId(), hasRegisteredPushToken()]).then(([org, push]) => {
      setOrgId(org);
      setPushEnabled(push);
    });
  }, []);

  const toggleBiometric = async (enabled: boolean) => {
    setBusy(true);
    const ok = await setBiometricEnabled(enabled);
    setFeedback(ok ? null : t("settings-biometric-unavailable"));
    setBusy(false);
  };

  const togglePush = async (enabled: boolean) => {
    setBusy(true);
    setFeedback(null);
    if (!enabled) {
      await disablePushNotifications();
      setPushEnabled(false);
      setBusy(false);
      return;
    }
    if (!orgId) {
      setFeedback(t("settings-notifications-failed"));
      setBusy(false);
      return;
    }
    const result = await registerPushNotifications(orgId);
    setPushEnabled(result.ok);
    if (!result.ok) setFeedback(t(`settings-notifications-${result.code}`));
    setBusy(false);
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: GRID * 2, gap: GRID * 3, paddingBottom: GRID * 5 }}
    >
      <View style={{ gap: GRID }}>
        <List.Subheader style={{ paddingHorizontal: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: GRID }}>
            <NiMoon size="small" color={theme.colors.onSurfaceVariant} />
            <Text variant="titleMedium">{t("settings-mode")}</Text>
          </View>
        </List.Subheader>
        <SegmentedButtons
          value={modeSetting}
          onValueChange={(value) => setModeSetting(value as typeof modeSetting)}
          buttons={[
            { value: "light", label: t("settings-mode-light") },
            { value: "dark", label: t("settings-mode-dark") },
            { value: "system", label: t("settings-mode-system") },
          ]}
        />
      </View>

      <View style={{ gap: 0 }}>
        <List.Subheader style={{ paddingHorizontal: 0 }}>{t("settings-security")}</List.Subheader>
        <List.Item
          title={t("settings-biometric")}
          description={t("settings-biometric-hint")}
          style={{ minHeight: TOUCH_TARGET }}
          right={() => (
            <Switch
              value={biometricEnabled}
              disabled={busy}
              onValueChange={(value) => void toggleBiometric(value)}
              accessibilityLabel={t("settings-biometric")}
            />
          )}
        />
        <List.Item
          title={t("settings-notifications")}
          description={t("settings-notifications-hint")}
          style={{ minHeight: TOUCH_TARGET }}
          right={() => (
            <Switch
              value={pushEnabled}
              disabled={busy}
              onValueChange={(value) => void togglePush(value)}
              accessibilityLabel={t("settings-notifications")}
            />
          )}
        />
        {feedback ? (
          <Text accessibilityLiveRegion="polite" variant="bodySmall" style={{ color: theme.colors.error }}>
            {feedback}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 0 }}>
        <List.Subheader style={{ paddingHorizontal: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: GRID }}>
            <NiMessages size="small" color={theme.colors.onSurfaceVariant} />
            <Text variant="titleMedium">{t("settings-language")}</Text>
          </View>
        </List.Subheader>
        {LOCALES.map((option: LocaleOption) => (
          <List.Item
            key={option}
            title={tDashboard(option)}
            onPress={() => setLocale(option)}
            style={{ minHeight: TOUCH_TARGET }}
            right={() => (locale === option ? <NiCheck size="large" color={theme.colors.primary} /> : null)}
          />
        ))}
      </View>

      {isSupabaseConfigured && session ? (
        <Button
          mode="outlined"
          textColor={theme.colors.error}
          onPress={signOut}
          contentStyle={{ minHeight: TOUCH_TARGET }}
          icon={() => <NiPower size="large" color={theme.colors.error} />}
        >
          {t("settings-sign-out")}
        </Button>
      ) : null}
    </ScrollView>
  );
}
