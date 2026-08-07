/**
 * Brand values for the PDF renderers, in one place.
 *
 * @react-pdf resolves no CSS variables and no Tailwind: a document is rendered
 * outside the browser, so the tokens in `@flyee/design-tokens` cannot reach it.
 * These literals are the ONE deliberate mirror of the palette (Teal primary,
 * PRD brand) — every renderer imports them instead of re-declaring its own set,
 * so a brand change has a single place to land here as well as in the tokens.
 */

export const PDF_ACCENT = "#177c81";
export const PDF_INK = "#1a1a1a";
export const PDF_MUTED = "#5c5c5c";
export const PDF_HAIRLINE = "#d8d8d8";
