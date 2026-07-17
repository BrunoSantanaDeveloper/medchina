// Message catalogs shared with apps/web via @flyee/content — same keys, same
// ICU format (use-intl is next-intl's engine, so behavior matches the web).
import de from "@flyee/content/mobile-messages/de.json";
import en from "@flyee/content/mobile-messages/en.json";
import es from "@flyee/content/mobile-messages/es.json";
import fr from "@flyee/content/mobile-messages/fr.json";
import ptBR from "@flyee/content/mobile-messages/pt-BR.json";

import type { LocaleOption } from "@/config";

export const MESSAGES: Record<LocaleOption, Record<string, unknown>> = {
  de,
  en,
  es,
  fr,
  "pt-BR": ptBR,
};
