import AsyncStorage from "@react-native-async-storage/async-storage";

import { createNativeClient, isNativeSupabaseConfigured } from "@flyee/auth/native";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False on a fresh clone — screens must show a configuration hint, not crash. */
export const isSupabaseConfigured = isNativeSupabaseConfigured({ url, anonKey });

export const supabase = isSupabaseConfigured ? createNativeClient({ url, anonKey, storage: AsyncStorage }) : null;
