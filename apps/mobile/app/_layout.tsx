import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { IntlProvider } from "use-intl";

import { MESSAGES } from "@/i18n/messages";
import { SessionProvider } from "@/providers/session";
import { DeliveryProvider } from "@/providers/delivery";
import { SettingsProvider, useSettings } from "@/providers/settings";
import { getTheme } from "@/theme";

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function ThemedApp() {
  const { themeName, mode, locale } = useSettings();
  const theme = getTheme(themeName, mode);

  return (
    <PaperProvider theme={theme}>
      {/* Consultation times are read against the phone's clock, in the room
          where she is — never UTC. */}
      <IntlProvider locale={locale} messages={MESSAGES[locale]} timeZone={deviceTimeZone()}>
        <SessionProvider>
          <DeliveryProvider>
            <StatusBar style={mode === "dark" ? "light" : "dark"} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.background },
              }}
            />
          </DeliveryProvider>
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
