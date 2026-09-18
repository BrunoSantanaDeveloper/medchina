"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button, ListItemIcon, Menu, MenuItem } from "@mui/material";

import { LOCALE_DISPLAY_ORDER, type LocaleOption } from "@/constants";
import { setClientLocale } from "@/i18n/locale";
import NiCheck from "@/icons/nexture/ni-check";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiMessages from "@/icons/nexture/ni-messages";
import { cn } from "@/lib/utils";

/**
 * Standalone language switcher for surfaces that have no user menu — today the
 * `/auth` screens.
 *
 * It exists because the language can be chosen FOR the visitor (browser
 * language or IP country, see lib/locale-detection.ts), and sign-in was the one
 * place that could be switched with no way to switch back: the app's switcher
 * lives in the user menu, which requires the session she is trying to open.
 *
 * Same cookie as every other switcher (`setClientLocale`), so a language picked
 * here is still in force after she signs in.
 */
export default function LocaleSwitch({ className }: { className?: string }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const open = Boolean(anchorEl);

  const choose = (next: LocaleOption) => {
    setAnchorEl(null);
    if (next === locale) return;
    startTransition(() => {
      setClientLocale(next);
    });
  };

  return (
    <>
      <Button
        variant="text"
        color="grey"
        size="small"
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("locale-switch-label")}
        disabled={isPending}
        startIcon={<NiMessages size="small" />}
        endIcon={<NiChevronDownSmall size="small" className={cn("transition-transform", open && "rotate-180")} />}
        className={className}
      >
        {/* The active language names ITSELF, so someone who cannot read the
            current language still recognizes what she is looking at. */}
        <span lang={locale}>{t(locale)}</span>
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        disableScrollLock
        classes={{ paper: "mt-1 w-56" }}
      >
        {LOCALE_DISPLAY_ORDER.map((option) => (
          <MenuItem
            key={option}
            // A screen reader must pronounce each option in ITS language, not
            // in the language the page happens to be in.
            lang={option}
            selected={option === locale}
            aria-current={option === locale}
            onClick={() => choose(option)}
          >
            <span className="w-full">{t(option)}</span>
            {option === locale && (
              <ListItemIcon className="mr-0 ml-2 justify-end">
                <NiCheck size="small" />
              </ListItemIcon>
            )}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
