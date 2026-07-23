"use client";

import { LOCAL_STORAGE_KEYS } from "@/constants";

/**
 * Product analytics behind an interface (flyee provider pattern — same as
 * billing/whatsapp/AI). `init()` runs ONLY after the user grants consent —
 * the gating is real by construction, not by promise.
 *
 * MedChina ships a Meta Pixel + GA4 provider (`createWebAdsProvider` below).
 * It activates ONLY when a tracking id is configured, and — because it is
 * mounted exclusively in the MARKETING layout — it NEVER loads on the
 * authenticated clinical app. That is a load-bearing compliance rule: the
 * app handles sensitive health data (LGPD Art. 11), so no ad/analytics
 * tracker is allowed to run over patient/consultation routes. The money
 * funnel events that happen INSIDE the app (checkout, trial start, purchase)
 * are sent SERVER-side via the Meta Conversions API (`lib/meta-capi.ts`),
 * never by a browser tracker on a clinical page.
 */
export interface AnalyticsProvider {
  /** Load/boot the SDK. Called once, only after consent is granted. */
  init(): void | Promise<void>;
  track?(event: string, props?: Record<string, unknown>): void;
  pageView?(path: string): void;
}

/** Public (browser-exposed) tracking ids — safe to ship to the client. */
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || null;
const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID?.trim() || null;

/**
 * Meta standard events we fire by name; anything else is sent as a Meta
 * custom event (`trackCustom`) so a typo never silently maps to the wrong
 * standard event.
 */
const META_STANDARD_EVENTS = new Set([
  "PageView",
  "ViewContent",
  "Lead",
  "CompleteRegistration",
  "Contact",
  "InitiateCheckout",
  "AddPaymentInfo",
  "StartTrial",
  "Subscribe",
  "Purchase",
]);

type Fbq = ((...args: unknown[]) => void) & {
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
  callMethod?: (...args: unknown[]) => void;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function loadMetaPixel(id: string) {
  if (window.fbq) return;
  const n = function (this: unknown, ...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args);
    else n.queue!.push(args);
  } as Fbq;
  window.fbq = n;
  if (!window._fbq) window._fbq = n;
  n.queue = [];
  n.loaded = true;
  n.version = "2.0";
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  window.fbq("init", id);
  window.fbq("track", "PageView");
}

function loadGa4(id: string) {
  if (window.gtag) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer || [];
  const gtag = (...args: unknown[]) => {
    window.dataLayer!.push(args);
  };
  window.gtag = gtag;
  gtag("js", new Date());
  // Initial page_view fires here; SPA navigations are sent via pageView().
  gtag("config", id, { anonymize_ip: true });
}

/**
 * Meta Pixel + GA4 behind the AnalyticsProvider interface. Returns null when
 * no id is configured — then the consent banner never renders and nothing
 * loads (graceful degradation, same as every other flyee provider).
 */
function createWebAdsProvider(): AnalyticsProvider | null {
  if (!META_PIXEL_ID && !GA4_ID) return null;
  return {
    init() {
      if (META_PIXEL_ID) loadMetaPixel(META_PIXEL_ID);
      if (GA4_ID) loadGa4(GA4_ID);
    },
    pageView(path) {
      if (META_PIXEL_ID) window.fbq?.("track", "PageView");
      if (GA4_ID) window.gtag?.("event", "page_view", { page_path: path });
    },
    track(event, props) {
      if (META_PIXEL_ID) {
        if (META_STANDARD_EVENTS.has(event)) window.fbq?.("track", event, props);
        else window.fbq?.("trackCustom", event, props);
      }
      if (GA4_ID) window.gtag?.("event", event, props);
    },
  };
}

export const ANALYTICS_PROVIDER: AnalyticsProvider | null = createWebAdsProvider();

/** Bump when the privacy policy changes materially — users are re-asked. */
export const CONSENT_VERSION = 1;

export interface ConsentState {
  analytics: boolean;
  version: number;
  at: string;
}

const CONSENT_EVENT = "flyee:cookie-consent";

export function getStoredConsent(): ConsentState | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEYS.cookieConsent);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    // A policy bump invalidates the stored answer — the banner asks again.
    return parsed.version === CONSENT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function storeConsent(analytics: boolean): ConsentState {
  const state: ConsentState = { analytics, version: CONSENT_VERSION, at: new Date().toISOString() };
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.cookieConsent, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode quota etc.) — consent still applies for this page view.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: state }));
  return state;
}

let initialized = false;

/** Idempotent: boots the provider once consent allows it. */
export function initAnalyticsIfConsented(consent: ConsentState | null = getStoredConsent()): void {
  if (initialized || !ANALYTICS_PROVIDER || !consent?.analytics) return;
  initialized = true;
  void ANALYTICS_PROVIDER.init();
}

/** Safe wrapper: silently drops events until provider + consent exist. */
export function track(event: string, props?: Record<string, unknown>): void {
  if (initialized) ANALYTICS_PROVIDER?.track?.(event, props);
}

/** Safe wrapper for SPA route changes: no-ops until provider + consent exist. */
export function trackPageView(path: string): void {
  if (initialized) ANALYTICS_PROVIDER?.pageView?.(path);
}
