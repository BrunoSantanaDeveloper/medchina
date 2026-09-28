import { LIVE_EVENT_OG_SIZE, liveEventOgImage } from "../components/live-event-og";

// The alt it had before the page became a template (the card renders the
// event's headline; this event's is stable, so its alt can say it).
export const alt = "Ao vivo com Debora Giovanella: o que muda para o acupunturista brasileiro depois da Lei 15.345";
export const size = LIVE_EVENT_OG_SIZE;
export const contentType = "image/png";
// The headline is the event's own content, edited in the console.
export const dynamic = "force-dynamic";

export default function LiveEventOpenGraphImage() {
  return liveEventOgImage("lei-15345");
}
