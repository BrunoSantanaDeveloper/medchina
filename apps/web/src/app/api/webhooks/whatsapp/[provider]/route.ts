import { NextResponse } from "next/server";

import { createServiceClient } from "@gogo/auth/service";
import { getWhatsAppProvider, handleWhatsAppWebhookEvents, type WhatsAppProviderName } from "@gogo/whatsapp";

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

  const body = (await request.json().catch(() => null)) as unknown;
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
