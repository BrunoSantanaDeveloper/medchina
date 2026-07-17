import { useFormik } from "formik";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { Button, Text, TextInput, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import * as Yup from "yup";

import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/session";
import { GRID, TOUCH_TARGET } from "@/theme";

export default function TwoFactor() {
  const t = useTranslations("mobile");
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, needsMfa, pendingPath, consumePendingPath, refreshAssurance } = useSession();
  const [serverError, setServerError] = useState(false);

  const formik = useFormik({
    initialValues: { code: "" },
    validationSchema: Yup.object({
      code: Yup.string().matches(/^\d{6}$/, t("mfa-invalid")).required(t("signin-required")),
    }),
    onSubmit: async ({ code }) => {
      if (!supabase) return;
      setServerError(false);
      const { data } = await supabase.auth.mfa.listFactors();
      const factor = data?.totp.find((item) => item.status === "verified");
      if (!factor) {
        setServerError(true);
        return;
      }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challengeError || !challenge) {
        setServerError(true);
        return;
      }
      const { error } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code,
      });
      if (error) {
        setServerError(true);
        return;
      }
      await refreshAssurance();
      const destination = await consumePendingPath();
      router.replace(destination ?? "/");
    },
  });

  useEffect(() => {
    if (session && !needsMfa) router.replace(pendingPath ?? "/");
  }, [needsMfa, pendingPath, router, session]);

  if (!session) return null;
  if (!needsMfa) return null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: GRID * 3,
          paddingTop: insets.top + GRID * 3,
          paddingBottom: insets.bottom + GRID * 3,
          gap: GRID * 2,
        }}
      >
        <View style={{ gap: GRID }}>
          <Text variant="headlineMedium">{t("mfa-title")}</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {t("mfa-hint")}
          </Text>
        </View>
        <TextInput
          mode="outlined"
          label={t("mfa-code")}
          value={formik.values.code}
          onChangeText={formik.handleChange("code")}
          onBlur={formik.handleBlur("code")}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          maxLength={6}
          error={Boolean((formik.touched.code && formik.errors.code) || serverError)}
          accessibilityLabel={t("mfa-code")}
        />
        {formik.touched.code && formik.errors.code ? (
          <Text variant="bodySmall" style={{ color: theme.colors.error }}>
            {formik.errors.code}
          </Text>
        ) : null}
        {serverError ? (
          <Text accessibilityLiveRegion="polite" variant="bodySmall" style={{ color: theme.colors.error }}>
            {t("mfa-failed")}
          </Text>
        ) : null}
        <Button
          mode="contained"
          onPress={() => formik.handleSubmit()}
          loading={formik.isSubmitting}
          disabled={formik.isSubmitting}
          contentStyle={{ minHeight: TOUCH_TARGET }}
        >
          {t("mfa-verify")}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
