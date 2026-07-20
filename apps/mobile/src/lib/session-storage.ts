import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SupportedStorage } from "@supabase/supabase-js";

import { decryptJson, encryptJson } from "@/lib/recording-crypto";

/**
 * Supabase's session store, encrypted at rest.
 *
 * The refresh token of a clinical account must not sit in plain text in
 * AsyncStorage (which is also swept into Android's cloud backup). The value is
 * sealed with the device key from SecureStore — the same envelope the recording
 * queue uses — so a file-level read of the app sandbox yields nothing usable.
 *
 * SecureStore alone is not an option here: a Supabase session exceeds its 2 KB
 * per-item limit.
 */
export const encryptedSessionStorage: SupportedStorage = {
  async getItem(key) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    try {
      return await decryptJson<string>(raw, `session:${key}`);
    } catch {
      // A key rotation or a restored backup leaves undecryptable bytes. Drop
      // them and let the app ask her to sign in again.
      await AsyncStorage.removeItem(key);
      return null;
    }
  },
  async setItem(key, value) {
    await AsyncStorage.setItem(key, await encryptJson(value, `session:${key}`));
  },
  async removeItem(key) {
    await AsyncStorage.removeItem(key);
  },
};
