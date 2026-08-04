import { NextResponse } from "next/server";

import { configuredProviders } from "@flyee/ai";
import { createClient } from "@flyee/auth/server";

/**
 * Which AI providers have a key in this deployment.
 *
 * The assistants console is a client component, so it cannot read server env.
 * Without this, an operator points an assistant at a provider whose key was
 * never set and nothing says so — the failure surfaces later, to a
 * PROFESSIONAL, mid-appointment, as a provider error she cannot act on.
 *
 * Returns booleans only. The keys themselves never leave the server, and the
 * superadmin gate is checked here because this describes the deployment's
 * configuration, not tenant data.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
  if (!profile?.is_superadmin) return NextResponse.json({ error: "not_authorized" }, { status: 403 });

  return NextResponse.json(
    { ok: true, providers: configuredProviders() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
