import LiveEventView, { liveEventMetadata } from "../components/live-event-view";
import type { Metadata } from "next";

/**
 * The first live event keeps its own address: `/lei-15345` is already printed
 * in e-mails, ads and QR codes. Every event after it lives at
 * `/ao-vivo/<slug>`; both render the same template from the event's row
 * (components/live-event-view.tsx, migration 0113).
 */
export const dynamic = "force-dynamic";

const SLUG = "lei-15345";

export function generateMetadata(): Promise<Metadata> {
  return liveEventMetadata(SLUG);
}

export default async function LeiEventPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <LiveEventView slug={SLUG} searchParams={await searchParams} />;
}
