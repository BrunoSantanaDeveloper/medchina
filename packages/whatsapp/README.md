# @flyee/whatsapp

WhatsApp dispatcher behind a provider interface — manual, automatic and **scheduled** sends, delivery/read tracking and **inbound replies as events**.

## Providers

| | `meta` (WhatsApp Cloud API, official) | `evolution` (Evolution API, unofficial) |
|---|---|---|
| Business-initiated messages | **Pre-approved template required**; free text only inside the 24h service window | Free text anytime |
| Onboarding | Meta Business verification + dedicated number | QR pairing with a regular number |
| Risk | None | Violates WhatsApp ToS — **the number can be banned**. MVP/low volume only |
| Hosting | Runs anywhere (plain REST) | Self-hosted server required (not Vercel) |

`sendTemplate` on Evolution sends the template's `fallbackText` (no native templates there) — always provide it so switching providers never breaks a flow.

## Sending

```ts
import { sendWhatsApp } from "@flyee/whatsapp";

await sendWhatsApp(supabase, {
  orgId,
  to: "5511999999999",
  template: {
    name: "appointment_confirmation",       // approved in the Meta panel
    bodyParams: [patientName, dateLabel],
    fallbackText: `Olá ${patientName}! Confirma sua consulta em ${dateLabel}? Responda SIM para confirmar.`,
  },
  sendAt: reminderDate,                      // omit for immediate send
  metadata: { appointmentId },
});
```

Every message (out and in) lands in `wa_messages` (RLS org-scoped, no delete — it is part of the audit trail) with status `queued → sent → delivered → read | failed`. Scheduled sends use Inngest `sleepUntil` (they require Inngest; immediate sends fall back to inline delivery). `cancelWhatsAppMessage(id)` cancels anything still queued.

## Replies (the confirmation loop)

Point the provider webhook at `/api/webhooks/whatsapp/meta` or `/api/webhooks/whatsapp/evolution`:

- Meta: app dashboard → WhatsApp → webhook, subscribe to `messages`, set the verify token.
- Evolution: instance webhook with `MESSAGES_UPSERT` + `MESSAGES_UPDATE` events; append `?token=<EVOLUTION_WEBHOOK_TOKEN>` to the URL.

Status updates land on the outbound row; inbound messages are logged and emitted as **`whatsapp/message.received`**. The derived project subscribes with an Inngest function for the business logic:

```ts
inngest.createFunction({ id: "confirm-appointment" }, { event: "whatsapp/message.received" }, async ({ event }) => {
  // Match event.data.from against patients, check for "SIM"/button reply,
  // mark the appointment confirmed.
});
```

## Env vars (apps/web/.env)

```
WHATSAPP_PROVIDER=meta | evolution
WHATSAPP_META_TOKEN=  WHATSAPP_META_PHONE_ID=  WHATSAPP_META_VERIFY_TOKEN=  WHATSAPP_META_API_VERSION= (default v23.0)
EVOLUTION_BASE_URL=  EVOLUTION_API_KEY=  EVOLUTION_INSTANCE=  EVOLUTION_WEBHOOK_TOKEN=
```

Without keys, `sendWhatsApp` fails the message with a clear hint and nothing else breaks. Migration: `packages/db/migrations/0008_whatsapp.sql`.
