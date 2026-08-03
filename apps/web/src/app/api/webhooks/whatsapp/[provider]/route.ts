import { NextResponse } from "next/server";

import { createServiceClient } from "@flyee/auth/service";
import { getWhatsAppProvider, handleWhatsAppWebhookEvents, type WhatsAppProviderName } from "@flyee/whatsapp";

const PROVIDERS: WhatsAppProviderName[] = ["meta", "evolution"];

const resolveProvider = (name: string) =>
  PROVIDERS.includes(name as WhatsAppProviderName) ? getWhatsAppProvider(name as WhatsAppProviderName) : null;

/** Meta's subscription handshake (hub.challenge). */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerName } = await params;
  const provider = resolveProvider(providerName);
  const response = provider?.verifyWebhook?.(request);
  return response ?? NextResponse.json({ error: "Unknown provider." }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerName } = await params;
  const provider = resolveProvider(providerName);
  if (!provider) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });

  // Evolution has no signature scheme; when EVOLUTION_WEBHOOK_TOKEN is set,
  // require it as ?token= on the webhook URL.
  if (provider.name === "evolution" && process.env.EVOLUTION_WEBHOOK_TOKEN) {
    const token = new URL(request.url).searchParams.get("token");
    if (token !== process.env.EVOLUTION_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: "Invalid webhook token." }, { status: 401 });
    }
  }

  // The RAW text, because the signature below is computed over the exact bytes
  // Meta sent — re-serializing a parsed object would not reproduce them.
  const rawBody = await request.text().catch(() => "");

  if (provider.verifySignature) {
    const verdict = provider.verifySignature(rawBody, request.headers);
    if (verdict === "invalid") {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
    }
    if (verdict === "unconfigured") {
      // Refusing is the only safe reading: this endpoint writes to the database
      // from an unauthenticated request, so "we cannot check" must never be
      // treated as "it checks out". Set WHATSAPP_META_APP_SECRET to enable it.
      console.warn("whatsapp_webhook_rejected_unverifiable", { provider: provider.name });
      return NextResponse.json({ error: "Webhook signature verification is not configured." }, { status: 401 });
    }
  }

  let body: unknown = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = null;
  }
  const events = body ? provider.parseWebhook(body) : [];

  if (events.length > 0) {
    try {
      const supabase = createServiceClient();
      await handleWhatsAppWebhookEvents(supabase, provider.name, events);
    } catch {
      // Missing service credentials — acknowledge anyway so the provider
      // does not retry forever against an unconfigured template clone.
    }
  }

  return NextResponse.json({ received: true });
}
