"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

import { Box, Button } from "@mui/material";

import NextureIcons, { IconName, IconVariant } from "@/icons/nexture-icons";
import { cn, isPathMatch } from "@/lib/utils";

type MenuLinkButtonProps = {
  to: string;
  icon?: IconName;
  iconVariant?: IconVariant;
  iconClassName?: string;
  avatarIcon?: IconName;
  avatarBgClassName?: string;
  size?: "small" | "medium" | "large" | "tiny";
  className?: string;
  children: ReactNode;
};

export function MenuLinkButton({
  to,
  icon,
  iconVariant = "outlined",
  iconClassName,
  avatarIcon,
  avatarBgClassName = "bg-primary",
  size = "large",
  className,
  children,
}: MenuLinkButtonProps) {
  const pathname = usePathname();
  const isActive = isPathMatch(pathname, to.split("?")[0]);

  return (
    <Button
      component={NextLink}
      href={to}
      variant="text"
      size={size}
      color="text-primary"
      className={cn(
        "full-width-button group hover:bg-grey-25 justify-start px-2.5",
        isActive && "active text-primary! bg-grey-25!",
        className,
      )}
      startIcon={
        avatarIcon ? (
          <Box className={cn("flex h-6 w-6 flex-none items-center justify-center rounded-full", avatarBgClassName)}>
            <NextureIcons icon={avatarIcon} size="small" className="text-white" />
          </Box>
        ) : icon ? (
          <NextureIcons
            icon={icon}
            variant={isActive ? "contained" : iconVariant}
            size="medium"
            className={iconClassName}
          />
        ) : undefined
      }
    >
      {children}
    </Button>
  );
}
