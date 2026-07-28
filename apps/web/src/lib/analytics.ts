"use client";

import { COOKIE_KEYS, LOCAL_STORAGE_KEYS } from "@/constants";

/**
 * Marketing analytics — OPT-OUT model.
 *
 * The Meta Pixel + GA4 base scripts are rendered SERVER-SIDE in the marketing
 * layout (`components/consent/marketing-trackers.tsx`) and load by DEFAULT, so
 * the trackers are present in the initial HTML (detectable, and firing for every
 * visitor). A visitor may opt out from the cookie notice, which sets the
 * `analyticsOptOut` cookie — read both server-side (to skip rendering the
 * scripts) and here (to stop emitting events and disable the loaded SDKs).
 *
 * The compliance rule is UNCHANGED and load-bearing: the trackers live ONLY in
 * the marketing layout and NEVER on the authenticated clinical app (LGPD Art. 11
 * — sensitive health data). In-app money-funnel events go SERVER-side via the
 * Conversions API / Measurement Protocol, never a browser tracker on a clinical
 * page. This module only fires PageView / ViewContent on the public site.
 */

const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || null;
const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID?.trim() || null;

/** Any tracker configured — the cookie notice renders only then. */
export const ANALYTICS_ENABLED = Boolean(META_PIXEL_ID || GA4_ID);

/**
 * Meta standard events we fire by name; anything else goes as a custom event
 * (`trackCustom`) so a typo never silently maps to the wrong standard event.
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

type Fbq = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** True once the visitor has opted out (cookie set by the notice). */
function isOptedOut(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((entry) => entry === `${COOKIE_KEYS.analyticsOptOut}=1`);
}

/**
 * Persists the opt-out for a year (read server-side on the next load to stop
 * rendering the scripts) and disables the ALREADY-loaded SDKs on this page.
 */
export function optOutOfAnalytics(): void {
  if (typeof document !== "undefined") {
    document.cookie = `${COOKIE_KEYS.analyticsOptOut}=1; path=/; max-age=31536000; samesite=lax`;
  }
  // GA4's documented kill-switch for an already-loaded gtag.
  if (GA4_ID && typeof window !== "undefined") {
    (window as unknown as Record<string, boolean>)[`ga-disable-${GA4_ID}`] = true;
  }
  // Meta has no per-page disable; we simply stop emitting (the base pixel only
  // auto-fires its initial PageView, never again on its own).
}

/** Fire a marketing event on the browser trackers. No-op if opted out. */
export function track(event: string, props?: Record<string, unknown>): void {
  if (typeof window === "undefined" || isOptedOut()) return;
  if (META_PIXEL_ID && window.fbq) {
    if (META_STANDARD_EVENTS.has(event)) window.fbq("track", event, props);
    else window.fbq("trackCustom", event, props);
  }
  if (GA4_ID) window.gtag?.("event", event, props);
}

/** Fire a PageView on SPA route changes. No-op if opted out. */
export function trackPageView(path: string): void {
  if (typeof window === "undefined" || isOptedOut()) return;
  if (META_PIXEL_ID) window.fbq?.("track", "PageView");
  if (GA4_ID) window.gtag?.("event", "page_view", { page_path: path });
}

/** Bump when the privacy policy changes materially — the notice re-appears. */
export const CONSENT_VERSION = 1;

export interface ConsentState {
  analytics: boolean;
  version: number;
  at: string;
}

/** The visitor's recorded acknowledgement — governs whether the notice shows. */
export function getStoredConsent(): ConsentState | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEYS.cookieConsent);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    // A policy bump invalidates the stored answer — the notice shows again.
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
    // Storage unavailable (private mode quota etc.) — the choice still applies for this page view.
  }
  return state;
}
