import { BRAND } from "@/brand";
import { createAnonClient } from "@/lib/public-content";

export type SupportChannels = {
  whatsapp: string;
  email: string;
  helpCenter: string;
};

/**
 * Quick-support channels for the floating widget, configured by the
 * superadmin at /admin/support (platform_settings table, 'support' key).
 * Falls back to the static BRAND.support values — and degrades to them
 * whenever Supabase is not configured — so the widget's "hidden until a
 * human channel exists" contract keeps working on a fresh clone.
 */
export async function getSupportChannels(): Promise<SupportChannels> {
  const fallback: SupportChannels = { ...BRAND.support };

  const supabase = createAnonClient();
  if (!supabase) return fallback;

  const { data, error } = await supabase.from("platform_settings").select("value").eq("key", "support").maybeSingle();
  if (error || !data?.value) return fallback;

  const value = data.value as Partial<SupportChannels>;
  return {
    whatsapp: typeof value.whatsapp === "string" ? value.whatsapp : fallback.whatsapp,
    email: typeof value.email === "string" ? value.email : fallback.email,
    helpCenter: fallback.helpCenter,
  };
}
