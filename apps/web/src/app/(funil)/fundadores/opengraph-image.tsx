import { ImageResponse } from "next/og";

import { BRAND } from "@/brand";
import { hsl, themes } from "@flyee/design-tokens";

export const alt = `Condição de fundadora — ${BRAND.name}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Link preview for the founders offer.
 *
 * Lives in the route's own folder, not in the `(funil)` group: a metadata image
 * is emitted per ROUTE, and the group root has no `page.tsx`, so a file placed
 * there registers nothing and the page ships with no `og:image` at all. A new
 * campaign page gets its own copy of this file.
 *
 * These pages are `noindex` and out of the sitemap, which says nothing about
 * sharing: the first wave is the founder's own WhatsApp, so this card IS the
 * first thing anyone sees of the offer. Without it the highest-intent link on
 * the site arrived as a bare grey rectangle.
 *
 * Deliberately says nothing about price, seats or deadline. Those come from the
 * database and change during the campaign; a static image would keep promising
 * whatever was true the day it was rendered — the one kind of stale number
 * docs/FUNIL.md refuses.
 */
export default function OfferOpenGraphImage() {
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
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: secondary,
          }}
        >
          Condição de fundadora
        </div>
        {/* One text child per node: Satori refuses a <div> with several
            children unless it declares display, and an interpolation splits a
            sentence into several. */}
        <div
          style={{ fontSize: 74, fontWeight: 800, letterSpacing: -2, marginTop: 26, maxWidth: 980, lineHeight: 1.1 }}
        >
          {`O ${BRAND.name} Pro completo, pelo preço do Assistente`}
        </div>
        <div style={{ fontSize: 32, marginTop: 26, maxWidth: 900, lineHeight: 1.3, opacity: 0.92 }}>
          Turma limitada de profissionais de Medicina Tradicional Chinesa, com migração acompanhada.
        </div>
      </div>
    ),
    size,
  );
}
