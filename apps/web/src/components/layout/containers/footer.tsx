"use client";

import Link from "next/link";
import { useTranslations } from "use-intl";

import { Box, Button } from "@mui/material";

/**
 * App footer. The template shipped a "purchase on ThemeForest" link here —
 * replaced by the product's own quiet links (help + legal), which is what a
 * clinical workspace should offer.
 */
const LINKS = [
  { key: "footer-help", href: "/ajuda" },
  { key: "footer-privacy", href: "/legal/privacidade" },
  { key: "footer-terms", href: "/legal/termos" },
] as const;

export default function Footer() {
  const t = useTranslations("marketing");

  return (
    <Box component="footer" className="flex h-10 items-center justify-center">
      {LINKS.map((link) => (
        <Button
          key={link.key}
          size="tiny"
          color="text-secondary"
          variant="text"
          className="hover:text-primary !bg-transparent font-normal"
          component={Link}
          href={link.href}
        >
          {t(link.key)}
        </Button>
      ))}
    </Box>
  );
}
