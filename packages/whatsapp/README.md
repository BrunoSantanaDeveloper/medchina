# @flyee/whatsapp

WhatsApp dispatcher behind a provider interface — manual, automatic and **scheduled** sends, delivery/read tracking and **inbound replies as events**.

> ## ⚠️ NOT the path MedChina uses today
>
> This package is **inert in MedChina**: no product code calls `sendWhatsApp`.
> The Meta Cloud API requires business verification and template approval, and
> charges per message — burden and cost the practice is not taking on right
> now. Evolution is out for a clinical product because it violates WhatsApp's
> ToS and risks a ban on the professional's own number.
>
> **Everything that reaches a patient over WhatsApp is a HANDOFF**: the app
> builds a `wa.me` deep link with the message already written
> (`apps/web/src/lib/whatsapp-link.ts`), opens it, and the professional presses
> send from her own number. See the agenda's confirmation link and the document
> delivery dialog (`components/product/plan-panel.tsx`).
>
> The code below stays for the day that decision changes — and the webhook
> signature check is live regardless, because the endpoint exists and must not
> accept forged payloads.
>
> **The one live use: confirming the professional's WhatsApp at sign-up
> (migration 0122).** It is a switch the operator turns on in `/admin/support`,
> and it is born OFF: until then the sign-up is confirmed by e-mail only, and
> this package stays as inert as before. With the switch on, she sends the code
> shown on her screen, from her own WhatsApp, to `WHATSAPP_SIGNUP_NUMBER` — an
> ordinary sign-up before the account exists, a campaign sign-up after the
> payment. That is INBOUND: the webhook (`/api/webhooks/whatsapp/meta`) logs
> the message here as always, then `apps/web/src/lib/signup-whatsapp.ts`
> matches it against the codes that are waiting and replies inside the 24h
> window she opened — free text, no approved template, no per-message charge
> for a user-initiated conversation. The switch refuses to turn on until the
> Cloud API number exists and the webhook can verify
> (`WHATSAPP_META_APP_SECRET`). Nothing business-initiated is sent.

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
WHATSAPP_META_APP_SECRET=   # REQUIRED to receive webhooks (see below)
EVOLUTION_BASE_URL=  EVOLUTION_API_KEY=  EVOLUTION_INSTANCE=  EVOLUTION_WEBHOOK_TOKEN=
```

**`WHATSAPP_META_APP_SECRET` is not optional for inbound.** The webhook URL is
public and guessable, so `POST /api/webhooks/whatsapp/meta` authenticates every
payload against the `X-Hub-Signature-256` HMAC Meta signs it with (app secret,
compared in constant time). Without the secret the route **refuses** the
request rather than trusting it — "cannot verify" must never read as "verified"
on an endpoint that writes to the database from an unauthenticated caller. Copy
the value from the Meta app dashboard (App settings → Basic → App secret).

Without keys, `sendWhatsApp` fails the message with a clear hint and nothing else breaks. Migration: `packages/db/migrations/0008_whatsapp.sql`.
