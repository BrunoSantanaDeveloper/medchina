import { ScrollView, View } from "react-native";
import { Card, Text, useTheme } from "react-native-paper";
import { useTranslations } from "use-intl";

import { BRAND } from "@flyee/content";

import { GRID, RADIUS } from "@/theme";

/**
 * Placeholder home proving the shared identity: every color/radius comes from
 * the token theme, matching apps/web. Derived projects replace this screen
 * with their product's real home (see the mobile-screen skill first).
 */
export default function Home() {
  const t = useTranslations("mobile");
  const theme = useTheme();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: GRID * 2, gap: GRID * 2 }}
    >
      <View style={{ gap: GRID / 2 }}>
        <Text variant="headlineMedium">{BRAND.name}</Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {t("home-subtitle")}
        </Text>
      </View>

      {/* Token swatch row: primary / secondary / tertiary from the active theme. */}
      <View style={{ flexDirection: "row", gap: GRID }}>
        {(["primary", "secondary", "tertiary"] as const).map((key) => (
          <View
            key={key}
            style={{
              flex: 1,
              height: GRID * 8,
              backgroundColor: theme.colors[key],
              borderRadius: RADIUS.xl,
              borderCurve: "continuous",
            }}
          />
        ))}
      </View>

      <Card mode="outlined" style={{ borderRadius: RADIUS["2xl"], borderCurve: "continuous" }}>
        <Card.Content style={{ gap: GRID }}>
          <Text variant="titleMedium">{t("home-title")}</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {t("home-hint")}
          </Text>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
