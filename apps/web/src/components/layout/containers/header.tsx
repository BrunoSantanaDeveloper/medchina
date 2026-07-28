"use client";
import Notifications from "../notifications/notifications";
import User from "../user/user";
import Link from "next/link";
import * as React from "react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import { Box, Button } from "@mui/material";

import { useLayoutContext } from "@/components/layout/layout-context";
import Logo from "@/components/logo/logo";
import CommandPalette from "@/components/product/command-palette";
import NiMenuSplit from "@/icons/nexture/ni-menu-split";
import { cn } from "@/lib/utils";

export default function Header() {
  const t = useTranslations("dashboard");
  const { showLeftInMobile, showLeftMobileButton, leftMenuWidth, leftShowBackdrop } = useLayoutContext();

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Box
        component="header"
        // Matches the mounted header's h-20: it used to be shorter, which both
        // shifted the layout on hydration and left no room for the logo.
        className="flex h-20 flex-none flex-row items-center"
        style={{ padding: `0 var(--main-padding)` }}
      >
        <Box className="flex h-full flex-row items-center">
          <Link href="/inicio">
            <Logo
              classNameFull="ml-2 hidden h-[54px] w-auto md:block"
              classNameMobile="ml-2 h-[54px] w-auto md:hidden"
            />
          </Link>
        </Box>
      </Box>
    );
  }

  return (
    <Box className="mui-fixed fixed z-20 h-20 w-full" component="header">
      <Box
        className={cn(
          "bg-background-paper flex h-full w-full flex-none flex-row items-center rounded-br-3xl sm:h-20",
          leftShowBackdrop && "pointer-events-none",
        )}
        style={{ padding: `0 var(--main-padding)` }}
      >
        <Box className="bg-background-paper shadow-darker-xs absolute inset-0 -z-10 rounded-b-3xl"></Box>
        {/* Left menu button */}
        <Button
          variant="text"
          size="large"
          color="text-primary"
          className={cn(
            "icon-only hover-icon-shrink [&.active]:text-primary [&.active]:bg-grey-25 hover:bg-grey-25",
            showLeftMobileButton ? "flex" : "hidden",
            leftMenuWidth.primary > 0 && "active",
          )}
          onClick={() => showLeftInMobile()}
          aria-label={t("menu-open")}
          aria-expanded={leftMenuWidth.primary > 0}
          aria-controls="primary-navigation"
          startIcon={<NiMenuSplit size={24} />}
        />
        <Box className="flex h-full flex-row items-center gap-6">
          {/* Logo — 2× the 27px default, sized against the 80px header. */}
          <Link href="/inicio">
            <Logo
              classNameFull="ml-2 hidden h-[54px] w-auto md:block"
              classNameMobile="ml-2 h-[54px] w-auto md:hidden"
            />
          </Link>

          {/* Version select */}
        </Box>

        {/* Right buttons */}
        <Box className="ml-auto flex flex-row sm:gap-1">
          <CommandPalette />
          <Notifications />
        </Box>

        {/* User Avatar and Menu */}
        <User />
      </Box>
    </Box>
  );
}
