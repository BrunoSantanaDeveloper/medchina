import AsyncStorage from "@react-native-async-storage/async-storage";

import { createNativeClient, isNativeSupabaseConfigured } from "@flyee/auth/native";

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False on a fresh clone — screens must show a configuration hint, not crash. */
export const isSupabaseConfigured = isNativeSupabaseConfigured({ url: supabaseUrl, anonKey: supabaseAnonKey });

export const supabase = isSupabaseConfigured
  ? createNativeClient({ url: supabaseUrl, anonKey: supabaseAnonKey, storage: AsyncStorage })
  : null;
