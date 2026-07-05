import { createClient as createSupabaseClient, type SupportedStorage } from "@supabase/supabase-js";

/**
 * Supabase client for React Native (Expo). The web entries don't work there:
 * `./client` depends on browser cookies, `./config` reads NEXT_PUBLIC_* env
 * vars that Expo never inlines. So the app passes its own EXPO_PUBLIC_* values
 * and a storage adapter (AsyncStorage), keeping this package free of any
 * React Native dependency.
 */
export type NativeClientOptions = {
  url: string | undefined;
  anonKey: string | undefined;
  /** e.g. `@react-native-async-storage/async-storage` default export. */
  storage: SupportedStorage;
};

export function isNativeSupabaseConfigured(options: Pick<NativeClientOptions, "url" | "anonKey">) {
  return Boolean(options.url && options.anonKey);
}

export function createNativeClient({ url, anonKey, storage }: NativeClientOptions) {
  if (!url || !anonKey) {
    throw new Error("Supabase URL and anon key are required — set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return createSupabaseClient(url, anonKey, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
      // No browser URL to read auth callbacks from in React Native.
      detectSessionInUrl: false,
    },
  });
}
