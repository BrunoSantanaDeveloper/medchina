import { useFormik } from "formik";
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { Banner, Button, Text, TextInput, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import * as Yup from "yup";

import NiEyeClose from "@/icons/nexture/ni-eye-close";
import NiEyeOpen from "@/icons/nexture/ni-eye-open";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { GRID, TOUCH_TARGET } from "@/theme";

export default function SignIn() {
  const t = useTranslations("mobile");
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const formik = useFormik({
    initialValues: { email: "", password: "" },
    validationSchema: Yup.object({
      email: Yup.string().email(t("signin-invalid-email")).required(t("signin-required")),
      password: Yup.string().required(t("signin-required")),
    }),
    validateOnBlur: false,
    validateOnMount: false,
    onSubmit: async (values) => {
      setServerError(null);
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithPassword(values);
      // The (auth) layout redirects on session change; only errors land here.
      if (error) setServerError(t("signin-failed"));
    },
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "flex-end",
          padding: GRID * 3,
          paddingTop: insets.top + GRID * 3,
          paddingBottom: insets.bottom + GRID * 4,
          gap: GRID * 2,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: GRID, marginBottom: GRID * 2 }}>
          <Text variant="headlineMedium">{t("signin-title")}</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {t("signin-subtitle")}
          </Text>
        </View>

        {!isSupabaseConfigured && <Banner visible>{t("signin-not-configured")}</Banner>}

        <TextInput
          mode="outlined"
          label={t("signin-email")}
          value={formik.values.email}
          onChangeText={formik.handleChange("email")}
          onBlur={formik.handleBlur("email")}
          error={Boolean(formik.touched.email && formik.errors.email)}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        {formik.touched.email && formik.errors.email && (
          <Text variant="labelLarge" style={{ color: theme.colors.error }}>
            {formik.errors.email}
          </Text>
        )}

        <TextInput
          mode="outlined"
          label={t("signin-password")}
          value={formik.values.password}
          onChangeText={formik.handleChange("password")}
          onBlur={formik.handleBlur("password")}
          error={Boolean(formik.touched.password && formik.errors.password)}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          right={
            <TextInput.Icon
              icon={() =>
                showPassword ? (
                  <NiEyeClose size="large" color={theme.colors.onSurfaceVariant} />
                ) : (
                  <NiEyeOpen size="large" color={theme.colors.onSurfaceVariant} />
                )
              }
              onPress={() => setShowPassword((show) => !show)}
            />
          }
        />
        {formik.touched.password && formik.errors.password && (
          <Text variant="labelLarge" style={{ color: theme.colors.error }}>
            {formik.errors.password}
          </Text>
        )}

        {serverError && (
          <Text variant="labelLarge" style={{ color: theme.colors.error }}>
            {serverError}
          </Text>
        )}

        {/* Primary action in the thumb zone (bottom third). */}
        <Button
          mode="contained"
          onPress={() => formik.handleSubmit()}
          loading={formik.isSubmitting}
          disabled={!isSupabaseConfigured || formik.isSubmitting}
          contentStyle={{ minHeight: TOUCH_TARGET }}
        >
          {t("signin-submit")}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
