import { ScrollView, View } from "react-native";
import { Button, List, SegmentedButtons, Text, useTheme } from "react-native-paper";
import { useTranslations } from "use-intl";

import type { ThemeName } from "@flyee/design-tokens";

import { LOCALES, type LocaleOption } from "@/config";
import NiCheck from "@/icons/nexture/ni-check";
import NiMessages from "@/icons/nexture/ni-messages";
import NiMoon from "@/icons/nexture/ni-moon";
import NiPalette from "@/icons/nexture/ni-palette";
import NiPower from "@/icons/nexture/ni-power";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { GRID, THEME_NAMES, TOUCH_TARGET, getTheme } from "@/theme";

// Locale display names come from the shared `dashboard` namespace (same keys
// the web language switcher uses).
export default function Settings() {
  const t = useTranslations("mobile");
  const tDashboard = useTranslations("dashboard");
  const theme = useTheme();
  const { themeName, modeSetting, mode, locale, setThemeName, setModeSetting, setLocale } = useSettings();
  const { session, isSupabaseConfigured, signOut } = useSession();

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: GRID * 2, gap: GRID * 3 }}>
      {/* Theme color */}
      <View style={{ gap: GRID }}>
        <List.Subheader style={{ paddingHorizontal: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: GRID }}>
            <NiPalette size="small" color={theme.colors.onSurfaceVariant} />
            <Text variant="titleMedium">{t("settings-theme")}</Text>
          </View>
        </List.Subheader>
        <View style={{ flexDirection: "row", gap: GRID }}>
          {THEME_NAMES.map((name: ThemeName) => {
            const swatch = getTheme(name, mode).colors.primary;
            const selected = name === themeName;
            return (
              <Button
                key={name}
                mode={selected ? "contained" : "outlined"}
                buttonColor={selected ? swatch : undefined}
                textColor={selected ? theme.colors.onPrimary : theme.colors.onSurface}
                onPress={() => setThemeName(name)}
                style={{ flex: 1 }}
                contentStyle={{ minHeight: TOUCH_TARGET }}
                icon={selected ? () => <NiCheck size="small" color={theme.colors.onPrimary} /> : undefined}
              >
                {t(`settings-theme-${name}`)}
              </Button>
            );
          })}
        </View>
      </View>

      {/* Light / dark / system */}
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

      {/* Language */}
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

      {/* Sign out — destructive, kept visually distinct */}
      {isSupabaseConfigured && session && (
        <Button
          mode="outlined"
          textColor={theme.colors.error}
          onPress={signOut}
          contentStyle={{ minHeight: TOUCH_TARGET }}
          icon={() => <NiPower size="large" color={theme.colors.error} />}
        >
          {t("settings-sign-out")}
        </Button>
      )}
    </ScrollView>
  );
}
