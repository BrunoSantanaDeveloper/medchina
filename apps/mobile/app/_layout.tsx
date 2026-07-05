import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { IntlProvider } from "use-intl";

import { MESSAGES } from "@/i18n/messages";
import { SessionProvider } from "@/providers/session";
import { SettingsProvider, useSettings } from "@/providers/settings";
import { getTheme } from "@/theme";

function ThemedApp() {
  const { themeName, mode, locale } = useSettings();
  const theme = getTheme(themeName, mode);

  return (
    <PaperProvider theme={theme}>
      <IntlProvider locale={locale} messages={MESSAGES[locale]} timeZone="UTC">
        <SessionProvider>
          <StatusBar style={mode === "dark" ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          />
        </SessionProvider>
      </IntlProvider>
    </PaperProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemedApp />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
