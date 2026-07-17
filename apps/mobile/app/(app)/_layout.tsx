import { Redirect, Tabs, usePathname } from "expo-router";
import { ActivityIndicator, Button, Text, useTheme } from "react-native-paper";
import { View } from "react-native";
import { useEffect } from "react";
import { useTranslations } from "use-intl";

import NiHome from "@/icons/nexture/ni-home";
import NiSettings from "@/icons/nexture/ni-settings";
import { useSession } from "@/providers/session";

export default function AppLayout() {
  const t = useTranslations("mobile");
  const theme = useTheme();
  const pathname = usePathname();
  const { session, loading, isSupabaseConfigured, assurance, needsMfa, localUnlocked, unlockLocally, setPendingPath } = useSession();

  useEffect(() => {
    if (needsMfa && /^\/consulta\/[0-9a-f-]+$/i.test(pathname)) {
      void setPendingPath(pathname as `/consulta/${string}`);
    }
  }, [needsMfa, pathname, setPendingPath]);

  if (loading || (session && assurance === "unknown")) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  // Without Supabase env the template stays browsable (same rule as web).
  if (isSupabaseConfigured && !session) return <Redirect href="/sign-in" />;
  if (session && needsMfa) {
    return <Redirect href="/two-factor" />;
  }
  if (session && !localUnlocked) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
        <Text variant="titleLarge">{t("unlock-title")}</Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}>
          {t("unlock-hint")}
        </Text>
        <Button mode="contained" onPress={() => void unlockLocally()}>
          {t("unlock-action")}
        </Button>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTitleStyle: { color: theme.colors.onSurface },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outlineVariant },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("home-title"),
          tabBarLabel: t("tab-home"),
          tabBarIcon: ({ color, focused }) => (
            <NiHome size="large" color={color} variant={focused ? "contained" : "outlined"} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("settings-title"),
          tabBarLabel: t("tab-settings"),
          tabBarIcon: ({ color, focused }) => (
            <NiSettings size="large" color={color} variant={focused ? "contained" : "outlined"} />
          ),
        }}
      />
      {/* Modo Consulta is pushed from the day's list — it is a destination, not
          a tab (its title is set per patient by the screen itself). */}
      <Tabs.Screen name="consulta/[id]" options={{ href: null }} />
    </Tabs>
  );
}
