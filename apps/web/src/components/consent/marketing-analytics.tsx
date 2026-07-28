"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { trackPageView } from "@/lib/analytics";

/**
 * Fires a PageView on client-side navigation between marketing routes. The
 * Pixel/GA4 base scripts (and the initial PageView) come from the server-rendered
 * `marketing-trackers.tsx`; this only reports genuine SPA transitions, so it
 * skips the first render. No-op if the visitor opted out.
 *
 * Mounted ONLY in the marketing layout — the trackers never run on the
 * authenticated clinical app (LGPD Art. 11: no ad tracker over health data).
 */
export default function MarketingAnalytics() {
  const pathname = usePathname();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
