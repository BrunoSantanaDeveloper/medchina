# Tracking & conversions (Meta Pixel + GA4 + CAPI)

Measurement for ads and analytics, built to survive a **health-data** product
(LGPD Art. 11). The governing rule: **no ad/analytics tracker ever runs on the
authenticated clinical app.** Browser trackers live only on the public marketing
site; the money-funnel events that happen inside the app are sent server-side.

## Where things live

| Concern | File |
|---|---|
| Pixel + GA4 base scripts, **SSR, opt-out** | `apps/web/src/components/consent/marketing-trackers.tsx` |
| Browser event helpers (`track`, `trackPageView`, opt-out) | `apps/web/src/lib/analytics.ts` |
| SPA PageView on marketing routes | `apps/web/src/components/consent/marketing-analytics.tsx` |
| One-shot event from a server page (e.g. ViewContent) | `apps/web/src/components/consent/track-event.tsx` |
| Cookie notice (opt-out; renders only when a tracker is configured) | `apps/web/src/components/consent/cookie-consent.tsx` |
| Server-side Meta Conversions API | `apps/web/src/lib/meta-capi.ts` (+ `meta-capi-context.ts`) |
| Server-side GA4 Measurement Protocol | `apps/web/src/lib/ga4-mp.ts` (+ `getGaClientId` in `meta-capi-context.ts`) |

The client Pixel/GA4 mount ONLY in the marketing layout. The dashboard layout
mounts neither the banner nor any tracker (see the comment in
`apps/web/src/app/(dashboard)/layout.tsx`).

## Consent — opt-out model (marketing site)

The Meta Pixel + GA4 base scripts are rendered **server-side** in the marketing
layout (`marketing-trackers.tsx`) and load by **default** — so they are present
in the initial HTML (detectable by audits) and fire for every visitor. A visitor
opts out from the cookie notice (`cookie-consent.tsx` → "Recusar análises"),
which sets the `analyticsOptOut` cookie: the SSR component then skips rendering
the scripts on the next load, and `lib/analytics.ts` stops emitting events and
sets GA4's `ga-disable-*` kill-switch immediately. With no id configured there is
nothing to load and the notice never renders. Bump `CONSENT_VERSION` when the
privacy policy changes materially — the notice re-appears.

This posture applies to the **public marketing site only** (audience of
professionals, not patients). The compliance boundary is unchanged: no tracker of
any kind runs on the authenticated clinical app. Server-side conversions
(CAPI/Measurement Protocol) currently fire regardless of the browser opt-out —
they are first-party measurement of the account holder's own transactions
(hashed); gate them on the opt-out cookie if a stricter posture is required.

## Event map

Split by where the event physically happens:

**Client (marketing site, Pixel + GA4 — opt-out)**
| Event | Where it fires |
|---|---|
| `PageView` | every marketing route (SSR Pixel/GA4 + `MarketingAnalytics`) |
| `ViewContent` | `/planos` (`TrackEvent`) |

**Server (Meta Conversions API — no browser tracker in the app)**
| Event | Where it fires | event_id | Match keys |
|---|---|---|---|
| `CompleteRegistration` | `auth/callback/route.ts` (new account only) | user id | email, user id, `_fbp`/`_fbc`, IP/UA |
| `Activated` | `api/consultations/[id]/finalize` (first finalized consultation) | `activated:<org>` | email, org id, `_fbp`/`_fbc`, IP/UA |
| `StartTrial` | `api/billing/start-trial` → `start_pro_trial` succeeds | `trial:<org>` | email, org id, `_fbp`/`_fbc`, IP/UA |
| `TrialExpiring` | `lib/trial-jobs.ts` drip, ~3 days before the trial ends | `trial-expiring:<org>` | org id, + `meta_attribution` keys (no request cookies) |
| `InitiateCheckout` | `settings/billing/actions.ts` → `startCheckout` | idempotency key | email, org id, `_fbp`/`_fbc`, IP/UA |
| `Purchase` | `api/webhooks/[provider]` → `payment_succeeded` (once per paid invoice) | `<provider>:<invoice>` | org id, value, + email/`_fbp`/`_fbc`/IP/UA from `meta_attribution` |
| `Subscribe` | same webhook, only the subscription's FIRST paid invoice | `subscribe:<sub>` | org id, value, + `meta_attribution` keys |

`event_id` is stable per event so a browser event of the same name deduplicates
against the server one, and renewals count as distinct purchases. `Activated` is
the product aha (first finalized consultation, `lib/onboarding.ts`) — server-side
with NO clinical data. `Subscribe` fires once per subscription (its first payment)
so Meta can optimize for new paying customers, while `Purchase` counts every paid
invoice including renewals.

**Server (GA4 Measurement Protocol — same call sites, mirrors the events above)**

| Meta event | GA4 event | params |
|---|---|---|
| `CompleteRegistration` | `sign_up` | `method` |
| `Activated` | `activated` | — |
| `StartTrial` | `start_trial` | — |
| `TrialExpiring` | `trial_expiring` | — |
| `InitiateCheckout` | `begin_checkout` | `currency`, `value` |
| `Purchase` | `purchase` | `currency`, `value`, `transaction_id` |
| `Subscribe` | `subscribe` | `currency`, `value` |

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

## Trial lifecycle drip + remarketing

The trial-first funnel needs an email drip AND segmented ad audiences (a
trial-first model converts on the TRIAL sequence, not generic nurture).

- **Email drip** (`apps/web/src/lib/trial-jobs.ts`, Inngest `medchina/trial.started`
  emitted from `api/billing/start-trial`): welcome (T+0) → activation nudge (T+2,
  only if not activated) → expiring (end−3d, also fires `TrialExpiring`) → ended.
  Each step re-checks state and skips a professional who converted or opted out.
  One template with four moments (`@flyee/email` `trial-lifecycle`); one-click
  unsubscribe (`/api/public/unsubscribe`, `profiles.email_unsubscribe_token`,
  migration 0056). Needs Inngest + Resend to run/send (no inline fallback).
- **Remarketing audiences** (built by hand in Meta Ads Manager from the events
  above): *signed up not activated* = `CompleteRegistration` AND NOT `Activated`;
  *activated not paying* = `Activated`/`StartTrial` AND NOT `Purchase`/`Subscribe`;
  *trial expiring* = the `TrialExpiring` event; **exclude** `Purchase`/`Subscribe`
  (payers) and recent `StartTrial` without `Purchase` (active trials) from
  acquisition campaigns.

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
