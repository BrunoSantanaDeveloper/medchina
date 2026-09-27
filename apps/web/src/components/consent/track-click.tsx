"use client";

import { track } from "@/lib/analytics";

/**
 * A plain link that fires ONE marketing event when clicked — the click-side
 * sibling of `TrackEvent` (which fires on mount). Renders a native `<a>`, not
 * next/link: the Landing DS buttons are anchors, and nothing here should be
 * prefetched.
 *
 * The event name is the caller's, but keep it OUT of Meta's standard events
 * (`CtaClick`, not `Lead`/`Purchase`): `track` sends unknown names as
 * `trackCustom`, so a click can never become what a campaign optimizes for
 * (docs/FUNIL.md, permanent rule). Only sound on PUBLIC marketing routes.
 * The event is a no-op for a visitor who opted out (lib/analytics); the link
 * always works.
 */
export default function TrackClick({
  href,
  event,
  props,
  className,
  children,
}: {
  href: string;
  event: string;
  props?: Record<string, unknown>;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a className={className} href={href} onClick={() => track(event, props)}>
      {children}
    </a>
  );
}
