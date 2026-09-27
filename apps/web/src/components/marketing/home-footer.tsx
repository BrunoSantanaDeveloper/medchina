import HomeBrand from "@/components/marketing/home-brand";
import type { HomeNavLink } from "@/components/marketing/home-header";

export type HomeFooterColumn = { title: string; links: HomeNavLink[] };

/**
 * The Landing DS site footer — extracted from the home, like the header, so
 * /china ends the way the home does. Server-safe (no state).
 *
 * The columns are data: the home points at its own anchors (#como-funciona,
 * #duvidas…), a page in another route group points at the real routes.
 */
export default function HomeFooter({
  brandLabel,
  brandHref,
  tagline,
  columns,
  rights,
  disclaimer,
}: {
  brandLabel: string;
  brandHref?: string;
  tagline: string;
  columns: HomeFooterColumn[];
  rights: string;
  disclaimer: string;
}) {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div className="footer-brand">
          <HomeBrand inverse label={brandLabel} href={brandHref} />
          <p>{tagline}</p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <strong>{column.title}</strong>
            {column.links.map((link) => (
              <a key={`${column.title}-${link.href}`} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
        ))}
      </div>
      <div className="footer-bottom">
        <span>{rights}</span>
        <p>{disclaimer}</p>
      </div>
    </footer>
  );
}
