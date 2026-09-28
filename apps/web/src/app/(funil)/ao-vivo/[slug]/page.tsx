import LiveEventView, { liveEventMetadata } from "../../components/live-event-view";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { isEventSlug, LEGACY_EVENT_PATHS } from "@/lib/live-event-common";

/**
 * Every live event created in /admin/eventos (migration 0113): one template,
 * the event's own content. Out of the index and the sitemap like the other
 * (funil) pages (FUNIL D10).
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  return isEventSlug(slug) ? liveEventMetadata(slug) : { robots: { index: false, follow: false } };
}

export default async function LiveEventPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  if (!isEventSlug(slug)) notFound();
  // An event that had its own address before this route existed keeps ONE URL.
  const legacy = LEGACY_EVENT_PATHS[slug];
  if (legacy) permanentRedirect(legacy);
  return <LiveEventView slug={slug} searchParams={await searchParams} />;
}
