"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { initAnalyticsIfConsented, trackPageView } from "@/lib/analytics";

/**
 * Fires a PageView on client-side navigation between marketing routes.
 *
 * Mounted ONLY in the marketing layout — this is the single reason the Meta
 * Pixel / GA4 stay off the authenticated clinical app (LGPD Art. 11: no ad
 * tracker over health data). The initial PageView is emitted by the Pixel/GA4
 * boot snippet itself, so this skips the first render and only reports genuine
 * SPA transitions. Everything is a no-op until the visitor grants consent.
 */
export default function MarketingAnalytics() {
  const pathname = usePathname();
  const firstRender = useRef(true);

  // A returning visitor who already consented boots the provider immediately
  // (the consent banner does the same, but this covers a mount without it).
  useEffect(() => {
    initAnalyticsIfConsented();
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
