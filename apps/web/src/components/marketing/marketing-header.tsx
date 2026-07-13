"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Drawer, IconButton, List, ListItem } from "@mui/material";

import Logo from "@/components/logo/logo";
import Container from "@/components/marketing/container";
import NiCross from "@/icons/nexture/ni-cross";
import NiMenu from "@/icons/nexture/ni-menu";

// HOME-SPEC §9.5: Como funciona · Recursos · Planos · Segurança · Dúvidas.
const NAV_LINKS = [
  { key: "nav-how-it-works", href: "/como-funciona" },
  { key: "nav-features", href: "/recursos" },
  { key: "nav-pricing", href: "/planos" },
  { key: "nav-security", href: "/seguranca" },
  { key: "nav-faq", href: "/#duvidas" },
] as const;

/**
 * Public site top navigation: logo, page links, sign-in + primary CTA,
 * collapsing into a drawer on mobile. Reuses the single <Logo> component.
 */
export default function MarketingHeader() {
  const t = useTranslations("marketing");
  const [open, setOpen] = useState(false);

  return (
    <Box component="header" className="bg-background/85 sticky top-0 z-30 w-full backdrop-blur-md">
      <Container className="flex h-16 flex-row items-center justify-between md:h-20">
        <Link href="/" aria-label={t("nav-home")} className="flex items-center">
          <Logo classNameFull="hidden md:block" classNameMobile="md:hidden" />
        </Link>

        {/* Desktop nav */}
        <Box component="nav" className="hidden flex-row items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Button key={link.key} variant="text" color="text-primary" href={link.href} LinkComponent={Link}>
              {t(link.key)}
            </Button>
          ))}
        </Box>

        <Box className="hidden flex-row items-center gap-2 md:flex">
          <Button variant="text" color="text-primary" href="/auth/sign-in" LinkComponent={Link}>
            {t("nav-sign-in")}
          </Button>
          <Button variant="contained" color="primary" href="/auth/sign-up" LinkComponent={Link}>
            {t("cta-primary")}
          </Button>
        </Box>

        {/* Mobile menu button */}
        <IconButton aria-label={t("nav-open-menu")} className="md:hidden" onClick={() => setOpen(true)}>
          <NiMenu size="large" />
        </IconButton>
      </Container>

      {/* Mobile drawer */}
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)} className="md:hidden">
        <Box className="flex w-72 max-w-[85vw] flex-col gap-2 p-4">
          <Box className="flex flex-row items-center justify-between">
            <Link href="/" aria-label={t("nav-home")} onClick={() => setOpen(false)}>
              <Logo classNameMobile="block" />
            </Link>
            <IconButton aria-label={t("nav-close-menu")} onClick={() => setOpen(false)}>
              <NiCross size="large" />
            </IconButton>
          </Box>
          <List className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <ListItem key={link.key} disablePadding>
                <Button
                  fullWidth
                  variant="text"
                  color="text-primary"
                  className="justify-start"
                  href={link.href}
                  LinkComponent={Link}
                  onClick={() => setOpen(false)}
                >
                  {t(link.key)}
                </Button>
              </ListItem>
            ))}
            <ListItem disablePadding>
              <Button
                fullWidth
                variant="text"
                color="text-primary"
                className="justify-start"
                href="/auth/sign-in"
                LinkComponent={Link}
                onClick={() => setOpen(false)}
              >
                {t("nav-sign-in")}
              </Button>
            </ListItem>
          </List>
          <Button variant="contained" color="primary" href="/auth/sign-up" LinkComponent={Link}>
            {t("cta-primary")}
          </Button>
        </Box>
      </Drawer>
    </Box>
  );
}
