"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { HomeCopy } from "@/components/marketing/home-copy";
import { type LocaleOption, LOCALES } from "@/constants";
import { setClientLocale } from "@/i18n/locale";
import { CaretDown, Check, Translate } from "@phosphor-icons/react";

/**
 * Language switcher for the public home (Landing DS: global class vocabulary,
 * direct Phosphor imports — see .claude/rules/marketing.md).
 *
 * It writes the same cookie the logged-in switcher writes, so a visitor who
 * chooses Chinese here and then signs up finds the app already in Chinese.
 * There is no /[locale]/ route to navigate to: language is a cookie, and the
 * server action's own revalidation is what re-renders the page.
 */
export default function HomeLanguageSwitch({
  current,
  copy,
  variant = "header",
}: {
  current: LocaleOption;
  copy: HomeCopy["language"];
  /** The mobile drawer lays the list out flat instead of in a popover. */
  variant?: "header" | "mobile";
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // A popover that cannot be dismissed with the keyboard or by clicking the
  // page is a trap on touch devices, where there is no Escape key.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (locale: LocaleOption) => {
    setOpen(false);
    if (locale === current) return;
    startTransition(() => {
      setClientLocale(locale);
    });
  };

  const options = LOCALES.map((locale) => (
    <button
      key={locale}
      className={`lang-option ${locale === current ? "is-active" : ""}`}
      type="button"
      // The page is in another language: a screen reader must still pronounce
      // each option in ITS language, not in the page's.
      lang={locale}
      aria-current={locale === current}
      onClick={() => choose(locale)}
    >
      <span>{copy.names[locale]}</span>
      {locale === current && <Check size={14} weight="bold" aria-hidden="true" />}
    </button>
  ));

  if (variant === "mobile") {
    return (
      <div className="lang-switch lang-switch--mobile" ref={containerRef} aria-busy={isPending}>
        <span className="lang-switch-label">{copy.label}</span>
        <div className="lang-menu lang-menu--flat" role="group" aria-label={copy.ariaLabel}>
          {options}
        </div>
      </div>
    );
  }

  return (
    <div className="lang-switch" ref={containerRef} aria-busy={isPending}>
      <button
        className="lang-switch-button"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={copy.ariaLabel}
        disabled={isPending}
      >
        <Translate size={17} weight="duotone" aria-hidden="true" />
        <span lang={current}>{copy.names[current]}</span>
        <CaretDown size={13} weight="bold" aria-hidden="true" className={open ? "is-open" : ""} />
      </button>
      {open && (
        <div className="lang-menu" role="group" aria-label={copy.ariaLabel}>
          {options}
        </div>
      )}
    </div>
  );
}
