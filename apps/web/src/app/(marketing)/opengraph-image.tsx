import { ImageResponse } from "next/og";

import { BRAND } from "@/brand";
import { hsl, themes } from "@flyee/design-tokens";

export const alt = `${BRAND.name} — ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Shared Open Graph card for the public site. Colors come from the generated
 * token mirror (blue theme), so a token change re-brands this image too.
 */
export default function OpenGraphImage() {
  const primary = hsl(themes.blue.light["primary"]);
  const primaryDark = hsl(themes.blue.light["primary-dark"]);

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
        <div style={{ fontSize: 88, fontWeight: 800, letterSpacing: -2 }}>{BRAND.name}</div>
        <div style={{ fontSize: 36, marginTop: 24, maxWidth: 900, lineHeight: 1.3, opacity: 0.95 }}>
          {BRAND.tagline}
        </div>
      </div>
    ),
    size,
  );
}
