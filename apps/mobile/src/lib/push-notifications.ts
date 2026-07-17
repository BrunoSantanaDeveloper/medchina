import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

const TOKEN_KEY = "medchina.expo-push-token.v1";
const SUPPORTED_LOCALES = ["pt-BR", "en", "es", "fr", "de"] as const;

function currentLocale(): (typeof SUPPORTED_LOCALES)[number] {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  if (locale.toLowerCase().startsWith("pt")) return "pt-BR";
  const language = locale.split("-")[0] as (typeof SUPPORTED_LOCALES)[number];
  return SUPPORTED_LOCALES.includes(language) ? language : "pt-BR";
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PushRegistrationResult =
  | { ok: true }
  | { ok: false; code: "permission_denied" | "device_required" | "configuration_missing" | "registration_failed" };

export async function registerPushNotifications(orgId: string): Promise<PushRegistrationResult> {
  if (!Device.isDevice) return { ok: false, code: "device_required" };
  if (!supabase) return { ok: false, code: "configuration_missing" };

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("clinical-status", {
      name: "MedChina",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return { ok: false, code: "permission_denied" };

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return { ok: false, code: "configuration_missing" };
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { data, error } = await supabase.rpc("register_mobile_device", {
      target_org: orgId,
      target_token: token,
      target_platform: Platform.OS,
      target_locale: currentLocale(),
    });
    const result = data as { ok?: boolean } | null;
    if (error || !result?.ok) return { ok: false, code: "registration_failed" };
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return { ok: true };
  } catch {
    return { ok: false, code: "registration_failed" };
  }
}

export async function disablePushNotifications(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token && supabase) await supabase.rpc("disable_mobile_device", { target_token: token });
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function hasRegisteredPushToken(): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(TOKEN_KEY));
}
