import { LIVE_EVENT_OG_SIZE, liveEventOgImage } from "../../components/live-event-og";

import { isEventSlug } from "@/lib/live-event-common";

export const alt = "Ao vivo com Debora Giovanella";
export const size = LIVE_EVENT_OG_SIZE;
export const contentType = "image/png";
// The headline is the event's own content, edited in the console.
export const dynamic = "force-dynamic";

export default async function LiveEventOpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return liveEventOgImage(isEventSlug(slug) ? slug : "");
}
