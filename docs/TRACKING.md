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
| Server-side Conversions API | `apps/web/src/lib/meta-capi.ts` (+ `meta-capi-context.ts`) |

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
| `Purchase` | `api/webhooks/[provider]` → `payment_succeeded` (once per paid invoice) | `<provider>:<invoice>` | org id, value |

`event_id` is stable per event so a browser event of the same name deduplicates
against the server one, and renewals count as distinct purchases.

`StartTrial` is the anchor event: `start_pro_trial()` now runs behind a server
route (`hooks/use-audio-allowance.ts` calls it) so the conversion fires on real
success and cannot be spoofed. `CompleteRegistration` fires in the auth callback,
which covers the confirmed-email and OAuth flows; if email confirmation is ever
DISABLED (the sign-up page then gets an immediate session and skips the
callback), add a server touchpoint on that path too.

### Fast-follow (better match quality)
- Store `_fbp`/`_fbc` at checkout so the (later, browserless) `Purchase` webhook
  can match on them too, and look up the org owner's email for `Purchase`.
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
  **Web** stream → **Measurement ID**, format `G-XXXXXXXXXX`.

## Verifying

1. Set the ids, accept the banner on the marketing site.
2. Meta **Test events** (with `META_CAPI_TEST_EVENT_CODE`): confirm `PageView`
   and `ViewContent` from the browser and `InitiateCheckout`/`Purchase` from the
   server, with `event_id` dedup shown.
3. GA4 **Realtime** report: confirm `page_view` and `view_content`.
4. Meta **Event Match Quality**: aim to raise it by passing more match keys.
