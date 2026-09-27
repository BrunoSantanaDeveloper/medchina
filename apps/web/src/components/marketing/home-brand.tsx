import Logo from "@/components/logo/logo";

/**
 * The Landing DS brand mark — the home's header and footer, and every page that
 * borrows them (/china). Server-safe: no state, so a server layout can render
 * it without shipping it to the browser.
 *
 * `href` is the one thing that differs: on the home it scrolls back to the top
 * (`#inicio`); anywhere else it goes to the home.
 */
export default function HomeBrand({
  inverse = false,
  label,
  href = "#inicio",
}: {
  inverse?: boolean;
  label: string;
  href?: string;
}) {
  return (
    <a className={`brand ${inverse ? "brand--inverse" : ""}`} href={href} aria-label={label}>
      {/* The one true logo (@/components/logo/logo.tsx) — same asset as the
          logged-in header. tone="contrast" swaps the teal shapes to white for
          the dark footer band; the camel wordmark gradient already reads on dark. */}
      <Logo classNameFull="h-9 w-auto" classNameMobile="hidden" tone={inverse ? "contrast" : "default"} />
    </a>
  );
}
