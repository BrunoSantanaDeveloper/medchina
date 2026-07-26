# Tracking & conversions (Meta Pixel + GA4 + CAPI)

Measurement for ads and analytics, built to survive a **health-data** product
(LGPD Art. 11). The governing rule: **no ad/analytics tracker ever runs on the
authenticated clinical app.** Browser trackers live only on the public marketing
site; the money-funnel events that happen inside the app are sent server-side.

## Where things live

| Concern | File |
|---|---|
| Client provider (Meta Pixel + GA4), consent-gated | `apps/web/src/lib/analytics.ts` |
| SPA PageView on marketing routes | `apps/web/src/components/consent/marketing-analytics.tsx` |
| One-shot event from a server page (e.g. ViewContent) | `apps/web/src/components/consent/track-event.tsx` |
| Consent banner (renders only when a provider is configured) | `apps/web/src/components/consent/cookie-consent.tsx` |
| Server-side Meta Conversions API | `apps/web/src/lib/meta-capi.ts` (+ `meta-capi-context.ts`) |
| Server-side GA4 Measurement Protocol | `apps/web/src/lib/ga4-mp.ts` (+ `getGaClientId` in `meta-capi-context.ts`) |

The client Pixel/GA4 mount ONLY in the marketing layout. The dashboard layout
mounts neither the banner nor any tracker (see the comment in
`apps/web/src/app/(dashboard)/layout.tsx`).

## Consent

The Pixel/GA4 boot ONLY after the visitor accepts the cookie banner
(`initAnalyticsIfConsented`). With no id configured there is nothing to consent
to, so the banner never renders. Bump `CONSENT_VERSION` in `lib/analytics.ts`
when the privacy policy changes materially — the banner re-asks.

## Event map

Split by where the event physically happens:

**Client (marketing site, consent-gated Pixel + GA4)**
| Event | Where it fires |
|---|---|
| `PageView` | every marketing route (Pixel/GA4 boot + `MarketingAnalytics`) |
| `ViewContent` | `/planos` (`TrackEvent`) |

**Server (Meta Conversions API — no browser tracker in the app)**
| Event | Where it fires | event_id | Match keys |
|---|---|---|---|
| `CompleteRegistration` | `auth/callback/route.ts` (new account only) | user id | email, user id, `_fbp`/`_fbc`, IP/UA |
| `StartTrial` | `api/billing/start-trial` → `start_pro_trial` succeeds | `trial:<org>` | email, org id, `_fbp`/`_fbc`, IP/UA |
| `InitiateCheckout` | `settings/billing/actions.ts` → `startCheckout` | idempotency key | email, org id, `_fbp`/`_fbc`, IP/UA |
| `Purchase` | `api/webhooks/[provider]` → `payment_succeeded` (once per paid invoice) | `<provider>:<invoice>` | org id, value, + email/`_fbp`/`_fbc`/IP/UA from `meta_attribution` |

`event_id` is stable per event so a browser event of the same name deduplicates
against the server one, and renewals count as distinct purchases.

**Server (GA4 Measurement Protocol — same call sites, mirrors the four above)**

| Meta event | GA4 event | params |
|---|---|---|
| `CompleteRegistration` | `sign_up` | `method` |
| `StartTrial` | `start_trial` | — |
| `InitiateCheckout` | `begin_checkout` | `currency`, `value` |
| `Purchase` | `purchase` | `currency`, `value`, `transaction_id` |

Each GA4 event is stitched to the visitor's web session via the `_ga` cookie
`client_id`. **No `client_id` → no GA4 event** — which is both required by the
protocol and correct consent behaviour (the `_ga` cookie only exists once the
visitor accepted analytics, so we never fabricate a GA4 user). For the browserless
`purchase`, the `client_id` is the one captured at checkout (`meta_attribution.ga_client_id`).

`StartTrial` is the anchor event: `start_pro_trial()` now runs behind a server
route (`hooks/use-audio-allowance.ts` calls it) so the conversion fires on real
success and cannot be spoofed. `CompleteRegistration` fires in the auth callback,
which covers the confirmed-email and OAuth flows; if email confirmation is ever
DISABLED (the sign-up page then gets an immediate session and skips the
callback), add a server touchpoint on that path too.

### Purchase match enrichment (implemented — migrations 0051 + 0052)
The `Purchase` webhook has no browser, so the tracking signals are captured at
checkout time instead: `startCheckout` reads the marketing-site `_fbp`/`_fbc`
cookies and the GA4 `_ga` `client_id` (same origin, no in-app tracker) plus
IP/UA/email and stores them in `public.meta_attribution` (service-role only, one
row per org, cascades on org deletion; `ga_client_id` added in 0052). The webhook
reads that row back and attaches those keys to both the Meta `Purchase` and the
GA4 `purchase` — so they match even for PIX/boleto that settle hours later and for
renewals. It only writes when a signal exists (the consent + ad-attribution
moment), so a plain checkout never wipes a stored row. With this, you may also
tick Email/`_fbp`/`_fbc`/IP on the Purchase event in the CAPI setup wizard.

### Fast-follow (optional)
- Add a predicted value to `StartTrial` (the Pro plan price) for value-based ad
  optimization.

## Configuration — where to get each value

Set these in Vercel (and `apps/web/.env` for local). All are optional; leaving
them empty disables tracking with no errors.

- **`NEXT_PUBLIC_META_PIXEL_ID`** — Meta Events Manager → *Data sources* → your
  dataset → the **Pixel ID** (a numeric id). Public by design.
- **`META_CAPI_TOKEN`** — same dataset → *Settings* → *Conversions API* →
  **Generate access token**. Server-only secret; never expose it.
- **`META_CAPI_TEST_EVENT_CODE`** *(optional)* — Events Manager → *Test events*
  tab shows a `TESTxxxxx` code; set it temporarily to watch events arrive live,
  then remove it.
- **`NEXT_PUBLIC_GA4_ID`** — Google Analytics → *Admin* → *Data streams* → your
  **Web** stream → **Measurement ID**, format `G-XXXXXXXXXX`. Public by design.
- **`GA4_API_SECRET`** — same Web stream → *Measurement Protocol API secrets* →
  **Create**. Server-only secret; powers the server-side GA4 conversions.

## Verifying

1. Set the ids, accept the banner on the marketing site.
2. Meta **Test events** (with `META_CAPI_TEST_EVENT_CODE`): confirm `PageView`
   and `ViewContent` from the browser and `InitiateCheckout`/`Purchase` from the
   server, with `event_id` dedup shown.
3. GA4 **Realtime** / **DebugView**: confirm `page_view` + `view_content` (browser)
   and `sign_up`/`start_trial`/`begin_checkout`/`purchase` (Measurement Protocol).
4. Meta **Event Match Quality**: aim to raise it by passing more match keys.
