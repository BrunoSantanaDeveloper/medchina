// The picker renders month/weekday names through the dayjs adapter, so every
// supported locale must be registered or the calendar silently falls back to en.
import "dayjs/locale/de";
import "dayjs/locale/es";
import "dayjs/locale/fr";
import "dayjs/locale/pt-br";

import { deDE, enUS, esES, frFR, ptBR } from "@mui/x-date-pickers/locales";

/** The picker's own chrome (action buttons, aria labels) ships per locale in MUI X. */
const PICKER_LOCALES = { "pt-BR": ptBR, en: enUS, es: esES, fr: frFR, de: deDE } as const;

export const pickerLocaleText = (locale: string) =>
  (PICKER_LOCALES[locale as keyof typeof PICKER_LOCALES] ?? ptBR).components.MuiLocalizationProvider.defaultProps
    .localeText;
