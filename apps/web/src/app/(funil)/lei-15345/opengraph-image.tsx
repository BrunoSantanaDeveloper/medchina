import { ImageResponse } from "next/og";

import { hsl, themes } from "@flyee/design-tokens";

export const alt = "Ao vivo com Debora Giovanella: o que muda para o acupunturista brasileiro depois da Lei 15.345";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Link preview for the live event — the card that decides the tap in WhatsApp.
 *
 * NO DATE on purpose, like the offer pages' cards (fundadores, assinar): this
 * image is rendered once, and WhatsApp caches a link's preview per URL. A date
 * printed here would stay wrong after the first reschedule. The date travels in
 * the text of the message that carries the link, and on the page.
 */
export default function LiveEventOpenGraphImage() {
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
          style={{ fontSize: 62, fontWeight: 800, letterSpacing: -2, marginTop: 26, maxWidth: 1040, lineHeight: 1.1 }}
        >
          O que muda para o acupunturista brasileiro depois da Lei 15.345
        </div>
        <div style={{ fontSize: 36, marginTop: 24, maxWidth: 940, lineHeight: 1.3, opacity: 0.92 }}>
          e o que eu vi na China.
        </div>
      </div>
    ),
    size,
  );
}
