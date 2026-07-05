import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, useTheme } from "react-native-paper";
import { View } from "react-native";
import { useTranslations } from "use-intl";

import NiHome from "@/icons/nexture/ni-home";
import NiSettings from "@/icons/nexture/ni-settings";
import { useSession } from "@/providers/session";

export default function AppLayout() {
  const t = useTranslations("mobile");
  const theme = useTheme();
  const { session, loading, isSupabaseConfigured } = useSession();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  // Without Supabase env the template stays browsable (same rule as web).
  if (isSupabaseConfigured && !session) return <Redirect href="/sign-in" />;

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
    </Tabs>
  );
}
