import { ImageResponse } from "next/og";

import { BRAND } from "@/brand";
import { hsl, themes } from "@flyee/design-tokens";

export const alt = `${BRAND.name} — prontuário com IA supervisionada para Medicina Tradicional Chinesa`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Link preview for the campaign landing page.
 *
 * Lives in the route's own folder because a metadata image is emitted per
 * ROUTE, and the `(funil)` group has no page of its own — a file placed there
 * registers nothing and the page ships with no `og:image` at all.
 *
 * Says nothing about price or deadline: both come from settings and change
 * during the campaign, and a static card would keep promising whatever was true
 * the day it was rendered.
 */
export default function SubscribeOpenGraphImage() {
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
          Medicina Tradicional Chinesa
        </div>
        {/* One text child per node: Satori refuses a <div> with several children
            unless it declares display, and an interpolation splits a sentence
            into several. */}
        <div
          style={{ fontSize: 74, fontWeight: 800, letterSpacing: -2, marginTop: 26, maxWidth: 980, lineHeight: 1.1 }}
        >
          Atenda olhando para a paciente
        </div>
        <div style={{ fontSize: 32, marginTop: 26, maxWidth: 900, lineHeight: 1.3, opacity: 0.92 }}>
          {`A consulta vira anamnese estruturada, preparada para a sua revisão no ${BRAND.name}.`}
        </div>
      </div>
    ),
    size,
  );
}
