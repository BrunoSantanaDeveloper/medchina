# MedChina companion app — store review handoff

This document is the release checklist for the Expo companion app. Replace every
`<release value>` before submitting a build.

## Product model for reviewers

MedChina mobile is a clinical capture companion for an existing professional
account. It records audio only after an explicit tap, keeps a persistent visual
recording indicator, uploads encrypted recoverable chunks, and shows processing
status. Review, patient management, documents, account administration and all
commercial activity are web-only.

Recording continues while the screen is locked or the app is backgrounded: a
consultation lasts 40–60 minutes with the phone resting on the table, and the
professional's attention belongs to the patient. This uses the iOS `audio`
background mode and an Android microphone foreground service (both from
`enableBackgroundRecording` in `app.json`), and it stops when she taps
“Encerrar”, not when the OS suspends the app. Both stores require this to be
declared — see the release gates below.

The app contains no price, subscription comparison, checkout, external purchase
link, renewal control or upgrade CTA. A server may grant a limited promotional
AI allowance on the professional's first real capture. This is not an App Store
or Google Play subscription, has no card, does not renew and cannot be purchased
inside the app. When unavailable, the app only reports that new AI capture is
unavailable; manual care and `audio_only` remain usable according to consent.

## App Review Notes template

- App role: companion clinical audio capture and delivery status.
- Recording path: sign in → today's consultation → choose AI or audio only →
  tap “Start recording” → OS microphone permission → visible timer/indicator →
  tap “Finish”.
- Patient recording consent is versioned and recorded on the authenticated web
  product. AI processing additionally requires its own current consent.
- Push notifications are opt-in and generic. They never contain patient names,
  symptoms, transcript excerpts, hypotheses or any other clinical content.
- Biometric authentication is only a local app lock. Accounts with a verified
  TOTP factor must still reach AAL2.
- There are no purchases or calls to purchase in this app.
- Demo account: `<reviewer email>` / `<reviewer password>`.
- TOTP seed or current reviewer code: `<release value>`.
- Prepared consultation ID/date: `<release value>`.
- Reviewer contact: `<name, email, phone>`.

## Release gates

- Create the EAS project (`eas init`) so `extra.eas.projectId` exists: push
  registration returns `configuration_missing` without it. Add `eas.json` with
  `development`/`preview`/`production` profiles and `appVersionSource: remote`
  plus `autoIncrement` — there is no `buildNumber`/`versionCode` in the repo.
- Answer `ITSAppUsesNonExemptEncryption` in `ios.infoPlist` before the first
  TestFlight upload. The app does more than HTTPS: recordings, the queue payload
  and the Supabase session are sealed locally with AES-256-GCM (`@noble/ciphers`,
  key in SecureStore). Decide the exemption with counsel and record it here.
- Declare background recording in both consoles: Apple asks why the `audio`
  background mode is needed (clinical capture with the screen locked), and Google
  Play requires the Foreground Service (microphone) declaration with a video of
  the flow. An undeclared foreground service type is an automatic rejection.
- Export `assets/icon.png` without an alpha channel (App Store Connect rejects a
  store icon with transparency); add `expo-splash-screen` so the app does not
  open on a blank white screen.
- `android.allowBackup` is `false` on purpose: encrypted clinical audio and
  session material must not be swept into Google's cloud backup. Keep it false.
- Set `EXPO_PUBLIC_WEB_URL` to the production HTTPS origin.
- Set `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256` in the web deployment and verify
  both `/.well-known/apple-app-site-association` and
  `/.well-known/assetlinks.json` from a clean device.
- Set the EAS project ID so explicit push opt-in can register a token.
- Provide a reviewer account with a scheduled consultation and both consent
  terms available; do not reuse production patient data.
- Confirm the microphone permission text and recording indicator on iOS and
  Android physical devices.
- Run the Maestro development-build journeys, including MFA, airplane mode,
  process kill, chunk retry and notification deep link.
- Run the background-capture matrix on PHYSICAL devices, iOS and Android. None
  of it can be exercised from Node, and each row is a way a consultation gets
  truncated: 45-minute capture untouched (screen auto-locks); power button
  mid-capture; incoming phone call; Control Center / notification shade; switch
  apps and return; kill the process (the capture must be recovered on next
  launch, never discarded); low battery / battery saver on Android. Record the
  result per device here before inviting testers.
- Confirm static bundle strings contain no trial, price, plan, upgrade,
  checkout or purchase copy.
- Complete Apple privacy labels and Google Data Safety from the actual release
  behavior, including clinical data, audio, identifiers and diagnostics.

Store approval is never guaranteed; this checklist documents the implemented
behavior and gives reviewers a reproducible path through it.
