import * as Linking from "expo-linking";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import type { Session } from "@supabase/supabase-js";

import { clearClinicalCache } from "@/lib/clinical-cache";
import { destinationFromUrl, type MobileDestination } from "@/lib/mobile-navigation";
import { clearCaptureAuthorization } from "@/lib/recording-authorization";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const BIOMETRIC_KEY = "medchina.biometric-lock.v1";
const PENDING_PATH_KEY = "medchina.pending-path.v1";

type Assurance = "unknown" | "not_required" | "aal1" | "aal2";

type SessionState = {
  session: Session | null;
  loading: boolean;
  isSupabaseConfigured: boolean;
  assurance: Assurance;
  needsMfa: boolean;
  localUnlocked: boolean;
  biometricEnabled: boolean;
  pendingPath: MobileDestination | null;
  refreshAssurance: () => Promise<void>;
  unlockLocally: () => Promise<boolean>;
  setBiometricEnabled: (enabled: boolean) => Promise<boolean>;
  setPendingPath: (path: MobileDestination | null) => Promise<void>;
  consumePendingPath: () => Promise<MobileDestination | null>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [assurance, setAssurance] = useState<Assurance>("unknown");
  const [localUnlocked, setLocalUnlocked] = useState(true);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [pendingPath, setPendingPathState] = useState<MobileDestination | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const refreshAssurance = useCallback(async () => {
    if (!supabase || !session) {
      setAssurance("unknown");
      return;
    }
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel === "aal2") setAssurance("aal2");
    else if (data?.nextLevel === "aal2") setAssurance("aal1");
    else setAssurance("not_required");
  }, [session]);

  const storePendingPath = useCallback(async (path: MobileDestination | null) => {
    setPendingPathState(path);
    if (path) await SecureStore.setItemAsync(PENDING_PATH_KEY, path);
    else await SecureStore.deleteItemAsync(PENDING_PATH_KEY);
  }, []);

  const unlockLocally = useCallback(async () => {
    if (!biometricEnabled) {
      setLocalUnlocked(true);
      return true;
    }
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (!hardware || !enrolled) return false;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "MedChina",
      disableDeviceFallback: false,
    });
    setLocalUnlocked(result.success);
    return result.success;
  }, [biometricEnabled]);

  useEffect(() => {
    Promise.all([
      SecureStore.getItemAsync(BIOMETRIC_KEY),
      SecureStore.getItemAsync(PENDING_PATH_KEY),
      Linking.getInitialURL(),
    ]).then(([biometric, storedPath, initialUrl]) => {
      const destination = initialUrl ? destinationFromUrl(initialUrl) : null;
      setBiometricEnabledState(biometric === "enabled");
      setLocalUnlocked(biometric !== "enabled");
      setPendingPathState(destination ?? (storedPath as MobileDestination | null));
    });
  }, []);

  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const destination = destinationFromUrl(url);
      if (destination) void storePendingPath(destination);
    });
    return () => subscription.remove();
  }, [storePendingPath]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setAssurance("unknown");
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void refreshAssurance();
  }, [session, refreshAssurance]);

  useEffect(() => {
    const listener = AppState.addEventListener("change", (next) => {
      const returning = /inactive|background/.test(appState.current) && next === "active";
      appState.current = next;
      if (!returning || !session) return;
      void refreshAssurance();
      if (biometricEnabled) {
        setLocalUnlocked(false);
        void unlockLocally();
      }
    });
    return () => listener.remove();
  }, [biometricEnabled, refreshAssurance, session, unlockLocally]);

  const value = useMemo<SessionState>(
    () => ({
      session,
      loading,
      isSupabaseConfigured,
      assurance,
      needsMfa: Boolean(session && assurance === "aal1"),
      localUnlocked,
      biometricEnabled,
      pendingPath,
      refreshAssurance,
      unlockLocally,
      setBiometricEnabled: async (enabled) => {
        if (enabled) {
          const [hardware, enrolled] = await Promise.all([
            LocalAuthentication.hasHardwareAsync(),
            LocalAuthentication.isEnrolledAsync(),
          ]);
          if (!hardware || !enrolled) return false;
          const result = await LocalAuthentication.authenticateAsync({ promptMessage: "MedChina" });
          if (!result.success) return false;
          await SecureStore.setItemAsync(BIOMETRIC_KEY, "enabled");
          setBiometricEnabledState(true);
          setLocalUnlocked(true);
          return true;
        }
        await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
        setBiometricEnabledState(false);
        setLocalUnlocked(true);
        return true;
      },
      setPendingPath: storePendingPath,
      consumePendingPath: async () => {
        const value = pendingPath;
        await storePendingPath(null);
        return value;
      },
      signOut: async () => {
        await supabase?.auth.signOut();
        // The next professional on this device must not inherit her day or her
        // capture grants. Queued audio is deliberately NOT touched: it is still
        // hers and still owed to a patient record.
        await clearClinicalCache().catch(() => undefined);
        await clearCaptureAuthorization().catch(() => undefined);
        await storePendingPath(null).catch(() => undefined);
        setAssurance("unknown");
        setLocalUnlocked(true);
      },
    }),
    [
      assurance,
      biometricEnabled,
      loading,
      localUnlocked,
      pendingPath,
      refreshAssurance,
      session,
      storePendingPath,
      unlockLocally,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
