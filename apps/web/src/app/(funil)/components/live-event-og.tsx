import { ImageResponse } from "next/og";

import { plain } from "@/components/marketing/home-copy/rich";
import { getLiveEvent } from "@/lib/live-event";
import { hsl, themes } from "@flyee/design-tokens";

export const LIVE_EVENT_OG_SIZE = { width: 1200, height: 630 };

/** "Main text **accent.**" → the two lines of the card. */
function splitAccent(headline: string): { main: string; accent: string | null } {
  const match = headline.match(/^(.*?)\*\*(.+?)\*\*(.*)$/s);
  if (!match) return { main: plain(headline), accent: null };
  return { main: plain(`${match[1]}${match[3]}`).trim(), accent: match[2].trim() };
}

/**
 * Link preview of an event page — the card that decides the tap in WhatsApp.
 * Read from the event's own headline, so a new event needs no image of its own.
 *
 * NO DATE on purpose, like the offer pages' cards: WhatsApp caches a link's
 * preview per URL, and a printed date would stay wrong after the first
 * reschedule. The date travels in the message that carries the link, and on the
 * page. A draft (or an unknown slug) gets the generic card: a preview must not
 * announce an event before the operator opens it.
 */
export async function liveEventOgImage(slug: string): Promise<ImageResponse> {
  const event = await getLiveEvent(slug);
  const visible = event && event.state !== "rascunho";
  const { main, accent } = visible
    ? splitAccent(event.headline ?? event.title)
    : { main: "Ao vivo no MedChina", accent: null };
  const mainSize = main.length > 150 ? 42 : main.length > 100 ? 50 : 62;

  const primary = hsl(themes.green.light["primary"]);
  const primaryDark = hsl(themes.green.light["primary-dark"]);
  const secondary = hsl(themes.green.light["secondary"]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: 80,
          background: `linear-gradient(135deg, ${primaryDark} 0%, ${primary} 100%)`,
          color: "#ffffff",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", color: secondary }}>
          Ao vivo com Debora Giovanella
        </div>
        {/* One text child per node: Satori refuses a <div> with several
            children unless it declares display. */}
        <div
          style={{
            fontSize: mainSize,
            fontWeight: 800,
            letterSpacing: -2,
            marginTop: 26,
            maxWidth: 1040,
            lineHeight: 1.1,
          }}
        >
          {main}
        </div>
        {accent ? (
          <div style={{ fontSize: 36, marginTop: 24, maxWidth: 940, lineHeight: 1.3, opacity: 0.92 }}>{accent}</div>
        ) : null}
      </div>
    ),
    LIVE_EVENT_OG_SIZE,
  );
}
