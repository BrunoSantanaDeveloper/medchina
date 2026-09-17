// The Landing DS (docs/DESIGN.md, "The Landing DS"): importing this stylesheet
// brings the whole vocabulary — :root custom properties, the @font-face pair,
// body typography and the class system (.section, .eyebrow, .button, …) — so an
// offer page looks like the home instead of like a different company.
import "../(marketing)/clinical-source-home.css";
import "./funil.css";

import { BRAND } from "@/brand";
import CookieConsent from "@/components/consent/cookie-consent";
import MarketingAnalytics from "@/components/consent/marketing-analytics";
import MarketingTrackers from "@/components/consent/marketing-trackers";
import Logo from "@/components/logo/logo";
import SupportWidget from "@/components/support/support-widget";
import { getSupportChannels } from "@/lib/platform-settings";

/**
 * Chrome for offer pages — a sibling route group to `(marketing)` for one
 * reason: a nested layout cannot REMOVE what its parent mounts, and these pages
 * must not carry the site menu.
 *
 * That is not a styling preference. An offer page has exactly one job, and the
 * site header is a row of exits from it — including the one that kills the sale
 * outright, "Criar conta grátis". If a visitor who was sent a founders link can
 * reach the free plan from here, the page failed (docs/FUNIL.md T3.1).
 *
 * What IS carried over, deliberately:
 *  - `MarketingTrackers` + `MarketingAnalytics` — the Pixel and GA4 mount only
 *    in the marketing layout, so without repeating them the highest-intent page
 *    on the site would be the one page with no measurement at all.
 *  - `CookieConsent` — same legal footing as the rest of the public site.
 *  - `SupportWidget` — the only way out on purpose: someone who needs to ask a
 *    question before paying should reach a human, not wander off.
 */
export default async function FunnelLayout({ children }: { children: React.ReactNode }) {
  const support = await getSupportChannels();
  return (
    <>
      {/* `.site-header` is the DS's own header class — the same one the home
          uses — so the mark sits exactly where a visitor expects it. The logo
          is deliberately NOT a link: on the public site it goes home, and home
          is the page with the free plan on it. */}
      <header className="site-header">
        <div className="header-inner">
          <span className="brand" aria-label={BRAND.name}>
            <Logo classNameFull="h-9 w-auto" classNameMobile="hidden" />
          </span>
        </div>
      </header>
      {children}
      {/* A commercial offer has to say who is selling and under which terms.
          The site footer cannot be reused for it: it is a menu, and every menu
          item here is an exit — starting with the free plan. So this is the
          legal minimum only, and each link opens in a new tab so reading the
          terms never ends the funnel. */}
      <footer className="site-footer offer-footer">
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} MedChina. Todos os direitos reservados.</span>
          <div className="offer-footer-links">
            <a href="/legal/termos" target="_blank" rel="noopener noreferrer">
              Termos de uso
            </a>
            <a href="/legal/privacidade" target="_blank" rel="noopener noreferrer">
              Política de privacidade
            </a>
            <a href="/legal/garantia" target="_blank" rel="noopener noreferrer">
              Garantia
            </a>
          </div>
        </div>
        <p className="offer-footer-note">
          {/* Identification of the seller, in the words of the company's own
              2021 filing: a page that takes payment has to say who is taking
              it (CDC art. 33), and the Meta review reads the destination. */}
          MedChina Gestão e Prontuários · CNPJ 38.504.491/0001-80 · Goiânia (GO) ·{" "}
          <a href="mailto:contato@medchinaprontuarios.com.br">contato@medchinaprontuarios.com.br</a>
          <br />O MedChina não substitui avaliação profissional, exame físico, observação da língua, palpação do pulso,
          análise de contraindicações ou encaminhamento quando necessário.
        </p>
      </footer>
      <SupportWidget support={support} />
      <CookieConsent />
      <MarketingTrackers />
      <MarketingAnalytics />
    </>
  );
}
