import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

import type { Mode, ThemeName } from "@flyee/design-tokens";

import { DEFAULTS, LOCALES, type LocaleOption } from "@/config";

type ModeSetting = Mode | "system";

type Settings = {
  themeName: ThemeName;
  modeSetting: ModeSetting;
  /** modeSetting with "system" resolved against the OS color scheme. */
  mode: Mode;
  locale: LocaleOption;
  setThemeName: (name: ThemeName) => void;
  setModeSetting: (mode: ModeSetting) => void;
  setLocale: (locale: LocaleOption) => void;
};

const KEYS = {
  themeName: "flyee-theme-color",
  modeSetting: "flyee-theme-mode",
  locale: "flyee-locale",
};

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [themeName, setThemeNameState] = useState<ThemeName>(DEFAULTS.themeName);
  const [modeSetting, setModeSettingState] = useState<ModeSetting>(DEFAULTS.modeSetting);
  const [locale, setLocaleState] = useState<LocaleOption>(DEFAULTS.locale);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.multiGet(Object.values(KEYS)).then((entries) => {
      const stored = Object.fromEntries(entries);
      const theme = stored[KEYS.themeName] as ThemeName | null;
      const mode = stored[KEYS.modeSetting] as ModeSetting | null;
      const storedLocale = stored[KEYS.locale] as LocaleOption | null;
      if (theme) setThemeNameState(theme);
      if (mode) setModeSettingState(mode);
      if (storedLocale && (LOCALES as readonly string[]).includes(storedLocale)) setLocaleState(storedLocale);
      setHydrated(true);
    });
  }, []);

  const value = useMemo<Settings>(
    () => ({
      themeName,
      modeSetting,
      mode: modeSetting === "system" ? (systemScheme === "dark" ? "dark" : "light") : modeSetting,
      locale,
      setThemeName: (name) => {
        setThemeNameState(name);
        AsyncStorage.setItem(KEYS.themeName, name);
      },
      setModeSetting: (mode) => {
        setModeSettingState(mode);
        AsyncStorage.setItem(KEYS.modeSetting, mode);
      },
      setLocale: (next) => {
        setLocaleState(next);
        AsyncStorage.setItem(KEYS.locale, next);
      },
    }),
    [themeName, modeSetting, locale, systemScheme],
  );

  // Avoid a settings flash: wait for the stored preferences before first paint.
  if (!hydrated) return null;

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used inside SettingsProvider");
  return context;
}
