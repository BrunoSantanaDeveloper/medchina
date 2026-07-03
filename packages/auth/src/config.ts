export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * True when Supabase env vars are present. The template degrades gracefully
 * without them (auth middleware no-ops, pages surface a configuration hint)
 * so a fresh clone is browsable before any Supabase project exists.
 */
export const isSupabaseConfigured = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
