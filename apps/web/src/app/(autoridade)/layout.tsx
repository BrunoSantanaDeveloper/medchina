// The Landing DS (docs/DESIGN.md, "The Landing DS"): the home's stylesheet
// brings the :root palette, the font faces and the class vocabulary; the shared
// blocks (founder card, tinted band) come right after it, as in (funil).
import "../(marketing)/clinical-source-home.css";
import "../landing-shared.css";

import CookieConsent from "@/components/consent/cookie-consent";
import MarketingAnalytics from "@/components/consent/marketing-analytics";
import MarketingTrackers from "@/components/consent/marketing-trackers";
import { homeCopyPtBR } from "@/components/marketing/home-copy/pt-BR";
import HomeFooter from "@/components/marketing/home-footer";
import HomeHeader from "@/components/marketing/home-header";
import SiteJsonLd from "@/components/marketing/site-json-ld";
import SupportWidget from "@/components/support/support-widget";
import { getSupportChannels } from "@/lib/platform-settings";

const nav = homeCopyPtBR.nav;
const footer = homeCopyPtBR.footer;

/**
 * Chrome for INDEXED landing pages that need the site header — today /china
 * (docs/PAGINA-CHINA.md §0.2).
 *
 * A sibling route group for the same reason (funil), palestra and pitch are: a
 * nested layout cannot remove what its parent mounts. Inside (marketing) the
 * page would inherit the library's MarketingHeader/MarketingFooter around a
 * Landing DS body — two design systems on one page — and the only escape is the
 * home's `body:has()` hack, which docs/FUNIL.md says not to repeat. (funil) does
 * not fit either: its contract is the opposite of this one (no menu, a logo
 * that goes nowhere, noindex, out of the sitemap).
 *
 * So this layout renders the home's OWN header and footer (extracted into
 * components/marketing/home-*), with real routes instead of the home's anchors,
 * no free sign-up (the page's one CTA is "Assinar") and no language switch (the
 * page is pt-BR). It emits no <main>: the page does, as in (funil).
 *
 * What (marketing) mounts and a public page needs is remounted here: the site
 * JSON-LD (Organization + WebSite, which the page's Article references by @id),
 * Pixel + GA4, the cookie notice and the support widget.
 *
 * The marketing hooks (guard/lint) do not fire on this group: the checklist in
 * docs/PAGINA-CHINA.md §7 is the check.
 */
export default async function AuthorityLayout({ children }: { children: React.ReactNode }) {
  const support = await getSupportChannels();
  return (
    <>
      <SiteJsonLd />
      <HomeHeader
        copy={nav}
        brandHref="/"
        links={[
          { href: "/como-funciona", label: nav.howItWorks },
          { href: "/recursos", label: nav.features },
          { href: "/planos", label: nav.plans },
          { href: "/seguranca", label: nav.security },
        ]}
        signInHref="/auth/sign-in"
      />
      {children}
      <HomeFooter
        brandLabel={nav.brandAria}
        brandHref="/"
        tagline={footer.tagline}
        columns={[
          {
            title: footer.productTitle,
            links: [
              { href: "/como-funciona", label: nav.howItWorks },
              { href: "/recursos", label: nav.features },
              { href: "/planos", label: nav.plans },
              { href: "/seguranca", label: nav.security },
            ],
          },
          {
            title: footer.accountTitle,
            links: [
              { href: "/auth/sign-in", label: nav.signIn },
              { href: "/ajuda", label: footer.helpCenter },
            ],
          },
          {
            title: footer.companyTitle,
            links: [
              { href: "/sobre", label: footer.about },
              { href: "/contato", label: footer.contact },
              { href: "/legal/privacidade", label: footer.privacy },
            ],
          },
        ]}
        rights={footer.rights}
        disclaimer={footer.disclaimer}
      />
      <SupportWidget support={support} />
      <CookieConsent />
      <MarketingTrackers />
      <MarketingAnalytics />
    </>
  );
}
