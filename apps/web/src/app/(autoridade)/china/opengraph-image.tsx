import { ImageResponse } from "next/og";

import { BRAND } from "@/brand";
import { hsl, themes } from "@flyee/design-tokens";

export const alt = "O prontuário brasileiro de Medicina Tradicional Chinesa apresentado na China — MedChina";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Link preview for /china — the card that decides the click in WhatsApp and in
 * a press e-mail.
 *
 * A TEXT card for now, like the offer pages' cards: the stage photo does not
 * exist yet, and when it does it cannot be embedded here as WebP (the Satori
 * bundled with Next throws "Unsupported image type: image/webp"). When the photo
 * arrives, replace THIS file with a static `opengraph-image.jpg` (1200×630) +
 * `opengraph-image.alt.txt` in this folder — a segment takes one or the other,
 * not both (docs/PAGINA-CHINA.md §6).
 *
 * No date and no price: a static card keeps promising whatever was true the day
 * it was rendered.
 */
export default function ChinaOpenGraphImage() {
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
          Congresso de MTC · Xinjiang, China
        </div>
        {/* One text child per node: Satori refuses a <div> with several
            children unless it declares display. */}
        <div
          style={{ fontSize: 70, fontWeight: 800, letterSpacing: -2, marginTop: 26, maxWidth: 1000, lineHeight: 1.1 }}
        >
          O prontuário brasileiro de MTC apresentado na China
        </div>
        <div style={{ fontSize: 32, marginTop: 26, maxWidth: 940, lineHeight: 1.3, opacity: 0.92 }}>
          {`${BRAND.name} · prontuário inteligente para Medicina Tradicional Chinesa`}
        </div>
      </div>
    ),
    size,
  );
}
