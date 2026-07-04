import { EvolutionProvider } from "./providers/evolution";
import { MetaProvider } from "./providers/meta";
import type { WhatsAppProvider, WhatsAppProviderName } from "./types";

export const isWhatsAppConfigured = () =>
  Boolean(
    (process.env.WHATSAPP_META_TOKEN && process.env.WHATSAPP_META_PHONE_ID) ||
      (process.env.EVOLUTION_BASE_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE),
  );

/** Active provider from WHATSAPP_PROVIDER (falls back to whichever has keys). */
export function getWhatsAppProvider(name?: WhatsAppProviderName): WhatsAppProvider {
  const selected =
    name ??
    (process.env.WHATSAPP_PROVIDER as WhatsAppProviderName | undefined) ??
    (process.env.WHATSAPP_META_TOKEN ? "meta" : process.env.EVOLUTION_BASE_URL ? "evolution" : undefined);

  switch (selected) {
    case "meta":
      return new MetaProvider();
    case "evolution":
      return new EvolutionProvider();
    default:
      throw new Error(
        "WhatsApp is not configured — set WHATSAPP_PROVIDER plus the provider keys (see packages/whatsapp/README.md).",
      );
  }
}
