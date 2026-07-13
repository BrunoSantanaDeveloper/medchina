import Link from "next/link";
import { useTranslations } from "next-intl";

import { BRAND } from "@/brand";
import Logo from "@/components/logo/logo";
import Container from "@/components/marketing/container";

// HOME-SPEC §26: Produto / Conta / Empresa / Suporte.
const COLUMNS = [
  {
    titleKey: "footer-product",
    links: [
      { key: "nav-how-it-works", href: "/como-funciona" },
      { key: "nav-features", href: "/recursos" },
      { key: "nav-pricing", href: "/planos" },
      { key: "footer-mobile", href: "/recursos#mobile" },
      { key: "nav-security", href: "/seguranca" },
    ],
  },
  {
    titleKey: "footer-account",
    links: [
      { key: "cta-primary", href: "/auth/sign-up" },
      { key: "nav-sign-in", href: "/auth/sign-in" },
      { key: "footer-help", href: "/ajuda" },
    ],
  },
  {
    titleKey: "footer-company",
    links: [
      { key: "nav-about", href: "/sobre" },
      { key: "nav-contact", href: "/contato" },
      { key: "footer-terms", href: "/legal/termos" },
      { key: "footer-privacy", href: "/legal/privacidade" },
      { key: "footer-cookies", href: "/legal/cookies" },
    ],
  },
  {
    titleKey: "footer-support",
    links: [
      { key: "footer-support-contact", href: "/contato" },
      { key: "footer-migration", href: "/migracao" },
      { key: "nav-faq", href: "/#duvidas" },
      { key: "footer-blog", href: "/blog" },
    ],
  },
] as const;

export default function MarketingFooter() {
  const t = useTranslations("marketing");

  return (
    <footer className="border-grey-100 w-full border-t">
      <Container className="flex flex-col gap-10 py-12 md:py-16">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="flex max-w-xs flex-col gap-3">
            <Link href="/" aria-label={t("nav-home")} className="flex items-center">
              <Logo classNameFull="block" />
            </Link>
            <p className="text-text-secondary text-base leading-5">{t("footer-tagline")}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div key={column.titleKey} className="flex flex-col gap-2">
                <p className="text-text-primary text-sm font-semibold tracking-wide uppercase">{t(column.titleKey)}</p>
                {column.links.map((link) => (
                  <Link
                    key={link.key}
                    href={link.href}
                    className="text-text-secondary hover:text-primary text-base leading-6 transition-colors"
                  >
                    {t(link.key)}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="border-grey-100 flex flex-col gap-2 border-t pt-6">
          <p className="text-text-secondary text-sm">
            © {new Date().getFullYear()} {BRAND.name}. {t("footer-rights")}
          </p>
          {/* HOME-SPEC §27.2 — the clinical-responsibility disclaimer, site-wide. */}
          <p className="text-text-secondary/80 max-w-3xl text-xs leading-5">{t("footer-disclaimer")}</p>
        </div>
      </Container>
    </footer>
  );
}
