import { AppState } from "react-native";

import { createNativeClient, isNativeSupabaseConfigured } from "@flyee/auth/native";

import { encryptedSessionStorage } from "@/lib/session-storage";

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False on a fresh clone — screens must show a configuration hint, not crash. */
export const isSupabaseConfigured = isNativeSupabaseConfigured({ url: supabaseUrl, anonKey: supabaseAnonKey });

export const supabase = isSupabaseConfigured
  ? createNativeClient({ url: supabaseUrl, anonKey: supabaseAnonKey, storage: encryptedSessionStorage })
  : null;

// supabase-js refreshes on a timer, which React Native suspends in the
// background: without this the first request after a long consultation races an
// expired token. Refreshing only while the app is in the foreground is the
// documented React Native pattern.
if (supabase) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
