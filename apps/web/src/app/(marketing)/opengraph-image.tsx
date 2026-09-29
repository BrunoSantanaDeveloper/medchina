import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { BRAND } from "@/brand";
import { common, hsl, themes } from "@flyee/design-tokens";

export const alt = `${BRAND.name} — ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// fs is the only way to reach the font and the mark without the renderer
// calling back into its own origin, which a build-time render would deadlock.
export const runtime = "nodejs";

/**
 * Shared Open Graph card for the public site — the image WhatsApp, LinkedIn and
 * Google show next to the link.
 *
 * It used to be the brand name set in Arial on a full teal gradient: not the
 * committed direction (light-first over Parchment, teal for the bold moment,
 * camel used once — docs/DESIGN.md), and it carried no mark at all. The gradient
 * was also why the mark could never be added to it: half of that mark IS teal,
 * so on a teal ground it disappears.
 *
 * Composition is centred rather than left-aligned on purpose. The 1200×630 card
 * is letterboxed into a near-square slot in Google's result and cropped by some
 * feeds; anything pushed to an edge is the first thing lost.
 */

/** `public/` is what ships; `src/fonts` is not traced into the serverless bundle. */
const publicAsset = (...segments: string[]) => path.join(process.cwd(), "public", ...segments);

/**
 * Both assets are optional by design. A missing font or mark must degrade to a
 * plainer card — an exception here returns no image at all, which costs every
 * link preview on the site, a far worse outcome than Satori's default face.
 */
async function loadAsset(file: string): Promise<Buffer | null> {
  return readFile(file).catch(() => null);
}

export default async function OpenGraphImage() {
  const primary = hsl(themes.green.light["primary"]);
  const secondary = hsl(themes.green.light["secondary"]);
  const background = hsl(common.light["background"]);
  const textPrimary = hsl(common.light["text-primary"]);
  const textSecondary = hsl(common.light["text-secondary"]);

  const [bold, medium, mark] = await Promise.all([
    loadAsset(publicAsset("fonts", "tt-chocolates-bold.otf")),
    loadAsset(publicAsset("fonts", "tt-chocolates-medium.otf")),
    loadAsset(publicAsset("brand", "medchina-mark.png")),
  ]);

  const fonts = [
    bold && { name: "TT Chocolates", data: bold, weight: 700 as const, style: "normal" as const },
    medium && { name: "TT Chocolates", data: medium, weight: 500 as const, style: "normal" as const },
  ].filter((font) => font !== null);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background,
          fontFamily: fonts.length > 0 ? "TT Chocolates" : "sans-serif",
        }}
      >
        {/* The hero glow of the site, flattened: a teal wash behind the lockup
            so the card has depth without a colour that fights the mark. */}
        <div
          style={{
            position: "absolute",
            top: -260,
            width: 900,
            height: 900,
            borderRadius: 450,
            background: `radial-gradient(circle, ${hsl(themes.green.light["primary"], 0.14)} 0%, ${hsl(themes.green.light["primary"], 0)} 70%)`,
          }}
        />
        {mark ? (
          <img
            width={148}
            height={148}
            alt=""
            src={`data:image/png;base64,${mark.toString("base64")}`}
            style={{ marginBottom: 34 }}
          />
        ) : null}
        <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: -2, color: textPrimary }}>{BRAND.name}</div>
        {/* The one camel moment the direction allows per surface. */}
        <div
          style={{
            width: 170,
            height: 4,
            marginTop: 22,
            borderRadius: 2,
            background: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`,
          }}
        />
        <div
          style={{
            fontSize: 34,
            fontWeight: 500,
            marginTop: 30,
            maxWidth: 860,
            textAlign: "center",
            lineHeight: 1.35,
            color: textSecondary,
          }}
        >
          {BRAND.description}
        </div>
      </div>
    ),
    { ...size, ...(fonts.length > 0 ? { fonts } : {}) },
  );
}
