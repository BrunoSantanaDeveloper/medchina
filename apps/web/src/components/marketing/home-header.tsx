"use client";

import { useState } from "react";

import HomeBrand from "@/components/marketing/home-brand";
import type { HomeCopy } from "@/components/marketing/home-copy";
import HomeLanguageSwitch from "@/components/marketing/home-language-switch";
import type { LocaleOption } from "@/constants";
import { List, X } from "@phosphor-icons/react";

export type HomeNavLink = { href: string; label: string };

/**
 * The Landing DS site header — extracted from the home so a landing page in
 * another route group (/china, in `(autoridade)`) carries the SAME header
 * instead of the library's MarketingHeader: two headers on one company's site
 * read as two companies (docs/DESIGN.md, "The Landing DS").
 *
 * What differs between pages is data, not markup: the home links to its own
 * anchors, offers the language switch and the free sign-up; /china links to the
 * real routes, has no sign-up (its one CTA is "Assinar") and no switch (pt-BR
 * only). The markup, classes and order are the home's, untouched.
 */
export default function HomeHeader({
  copy,
  links,
  signInHref,
  cta,
  brandHref,
  language,
}: {
  copy: Pick<HomeCopy["nav"], "brandAria" | "desktopAria" | "mobileAria" | "signIn" | "openMenu" | "closeMenu">;
  links: HomeNavLink[];
  signInHref: string;
  /** The filled header button. The home: the free sign-up. Omit for none. */
  cta?: HomeNavLink | null;
  /** Where the brand mark goes. The home scrolls to its top (`#inicio`). */
  brandHref?: string;
  /** The language switch; only the home, which is translated, shows it. */
  language?: { copy: HomeCopy["language"]; locale: LocaleOption } | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-inner">
        <HomeBrand label={copy.brandAria} href={brandHref} />
        <nav className="desktop-nav" aria-label={copy.desktopAria}>
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          {language ? <HomeLanguageSwitch current={language.locale} copy={language.copy} /> : null}
          <a className="login-link" href={signInHref}>
            {copy.signIn}
          </a>
          {cta ? (
            <a className="button button--sm" href={cta.href}>
              {cta.label}
            </a>
          ) : null}
        </div>
        <button
          className="menu-button"
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? copy.closeMenu : copy.openMenu}
        >
          {open ? <X size={24} /> : <List size={24} />}
        </button>
      </div>
      {open && (
        <nav className="mobile-nav" aria-label={copy.mobileAria}>
          {links.map((link) => (
            <a key={link.href} onClick={() => setOpen(false)} href={link.href}>
              {link.label}
            </a>
          ))}
          <a href={signInHref}>{copy.signIn}</a>
          {cta ? (
            <a className="button" href={cta.href}>
              {cta.label}
            </a>
          ) : null}
          {language ? <HomeLanguageSwitch current={language.locale} copy={language.copy} variant="mobile" /> : null}
        </nav>
      )}
    </header>
  );
}
