"use client";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { Box, Paper, Typography } from "@mui/material";

import { AiChatMenuContent } from "@/app/(dashboard)/applications/ai-chat/components/menu-content";
import { useLayoutContext } from "@/components/layout/layout-context";
import PlanIndicator from "@/components/layout/menu/plan-indicator";
import { PrimaryItem } from "@/components/layout/menu/primary-item";
import { SecondaryItem } from "@/components/layout/menu/secondary-item";
import { DEFAULTS } from "@/config";
import { useIsSuperadmin } from "@/hooks/use-is-superadmin";
import { cn, isPathMatch } from "@/lib/utils";
import { leftMenuBottomItems, leftMenuItems } from "@/menu-items";
import { MenuItem, MenuShowState, MenuType } from "@/types";

export type OpenedAccordion = { indent: number; id: string };

export default function LeftMenu() {
  const t = useTranslations("dashboard");
  const pathname = usePathname();
  const router = useRouter();
  const {
    leftMenuType,
    leftMenuWidth,
    leftPrimaryCurrent,
    leftSecondaryCurrent,
    showLeftSecondary,
    hideLeftSecondary,
    hideLeft,
    resetLeftMenu,
    onResetLeft,
    leftShowBackdrop,
    setLeftShowBackdrop,
    showLeftMobileButton,
  } = useLayoutContext();

  const selectedPrimary = useRef<undefined | MenuItem>(undefined);
  const [activeItem, setActiveItem] = useState<MenuItem | undefined>(undefined);
  const [openedAccordions, setOpenedAccordions] = useState<OpenedAccordion[]>([]);

  const isSuperadmin = useIsSuperadmin();
  const visibleMenuItems = useMemo(
    () => leftMenuItems.filter((item) => !item.superadminOnly || isSuperadmin),
    [isSuperadmin],
  );

  useEffect(() => {
    let selectedMenu = visibleMenuItems.find((item) => item.href && isPathMatch(pathname, item.href));
    if (!selectedMenu && leftMenuBottomItems) {
      selectedMenu = leftMenuBottomItems.find((item) => item.href && isPathMatch(pathname, item.href));
    }
    selectedPrimary.current = selectedMenu;
    setActiveItem(selectedMenu);
    resetLeftMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, visibleMenuItems]);

  useEffect(() => {
    if (selectedPrimary.current?.id !== activeItem?.id && !leftShowBackdrop) {
      setLeftShowBackdrop(true);
    }
  }, [activeItem?.id, selectedPrimary.current?.id, setLeftShowBackdrop, leftShowBackdrop]);

  useEffect(() => {
    const resetCallback = () => {
      if (selectedPrimary.current) {
        setActiveItem(selectedPrimary.current);
        if (!selectedPrimary.current.children || !selectedPrimary.current.children.length) {
          hideLeftSecondary();
        }
      }
    };

    onResetLeft(resetCallback);

    return () => {
      onResetLeft(() => {});
    };
  }, [onResetLeft, hideLeftSecondary]);

  const handleSelectPrimaryItem = (item: MenuItem) => {
    setActiveItem(item);
    if (item.children && item.children.length > 0) {
      showLeftSecondary();
    } else {
      // close all opened accordions
      // if the item is the same as the current path, hide the secondary menu and reset the left menu
      if (isPathMatch(pathname, item.href || "")) {
        hideLeftSecondary();
        resetLeftMenu();
      } else {
        setOpenedAccordions([]);
        router.push(item.href ?? "");
      }
    }
  };

  useEffect(() => {
    if (!activeItem) {
      if (showLeftMobileButton) {
        hideLeftSecondary();
      } else {
        hideLeft();
      }
    }
  }, [hideLeft, activeItem, showLeftMobileButton, hideLeftSecondary]);

  useEffect(() => {
    if (!activeItem?.children && leftSecondaryCurrent === MenuShowState.Hide) {
      hideLeftSecondary();
    }
  }, [activeItem, hideLeftSecondary, leftSecondaryCurrent]);

  const leftSecondaryDefaultWidth = useMemo(() => DEFAULTS.leftMenuWidth[leftMenuType].secondary, [leftMenuType]);

  const customSecondaryContent = useMemo(() => {
    if (pathname.startsWith("/applications/ai-chat")) return <AiChatMenuContent />;
    return null;
  }, [pathname]);
  return (
    <nav
      id="primary-navigation"
      aria-label={t("menu-navigation")}
      className="bg-background-paper shadow-darker-xs fixed z-10 mt-20 flex h-[calc(100%-5rem)] flex-row rounded-r-3xl"
    >
      <Box
        className={cn(
          "flex h-full shrink-0 grow-0 flex-col items-center overflow-x-hidden py-2.5! transition-all duration-(--layout-duration)",
        )}
        style={{
          ...(leftPrimaryCurrent !== MenuShowState.Hide && leftMenuWidth.primary > 0
            ? { width: `${leftMenuWidth.primary}px` }
            : { width: "0px" }),
        }}
      >
        <Box
          className={cn(
            leftMenuType === MenuType.SingleLayer &&
              leftPrimaryCurrent !== MenuShowState.Hide &&
              leftMenuWidth.primary > 0 &&
              "overflow-y-scroll px-4 py-2",
            "absolute flex h-full min-h-full shrink-0 grow-0 flex-col items-center gap-0.5 overflow-y-auto",
          )}
          style={{
            ...(leftPrimaryCurrent !== MenuShowState.Hide && leftMenuWidth.primary > 0
              ? { width: `${leftMenuWidth.primary}px` }
              : { width: "0px" }),
          }}
          tabIndex={0}
          aria-label={t("menu-navigation")}
        >
          <Box className={cn("flex flex-1 flex-col gap-0.5")}>
            {visibleMenuItems.map((item) =>
              leftMenuType !== MenuType.SingleLayer ? (
                <PrimaryItem
                  className={cn(leftShowBackdrop && "z-20")}
                  item={item}
                  key={`left-menu-primary-item-${leftMenuType}-${item.id}`}
                  onSelect={(item) => handleSelectPrimaryItem(item)}
                  isActive={activeItem?.id === item.id}
                  menuType={leftMenuType}
                />
              ) : (
                <SecondaryItem
                  className={cn(leftShowBackdrop && "z-20")}
                  item={item}
                  key={`left-menu-primary-item-${leftMenuType}-${item.id}`}
                  indent={0}
                  openedAccordions={openedAccordions}
                  setOpenedAccordions={setOpenedAccordions}
                />
              ),
            )}
          </Box>
          <Box className={cn("mb-5 flex w-full flex-col items-center gap-0.5")}>
            {/* Which plan this workspace is on. Hidden on the consultation
                route: there is a patient in the room and the screen is the
                capture surface — commercial chrome waits. */}
            {!pathname.startsWith("/consultas/") && <PlanIndicator menuType={leftMenuType} />}
            {leftMenuBottomItems.map((item) =>
              leftMenuType !== MenuType.SingleLayer ? (
                <PrimaryItem
                  className={cn(leftShowBackdrop && "z-20")}
                  item={item}
                  key={`left-menu-bottom-item-${leftMenuType}-${item.id}`}
                  onSelect={(item) => handleSelectPrimaryItem(item)}
                  isActive={activeItem?.id === item.id}
                  menuType={leftMenuType}
                />
              ) : (
                <SecondaryItem
                  className={cn(leftShowBackdrop && "z-20")}
                  item={item}
                  key={`left-menu-bottom-item-${leftMenuType}-${item.id}`}
                  indent={0}
                  openedAccordions={openedAccordions}
                  setOpenedAccordions={setOpenedAccordions}
                />
              ),
            )}
          </Box>
        </Box>
      </Box>
      {leftMenuType !== MenuType.SingleLayer && (
        <Box
          className={cn(
            "shadow-line-left flex h-full shrink-0 grow-0 overflow-x-hidden transition-all duration-(--layout-duration)",
            leftShowBackdrop && "z-20",
          )}
          style={{
            width:
              activeItem?.children &&
              activeItem?.children.length > 0 &&
              leftSecondaryCurrent !== MenuShowState.Hide &&
              leftMenuWidth.secondary > 0
                ? `${leftMenuWidth.secondary}px`
                : 0,
          }}
        >
          <Box className="h-full w-full">
            <Paper elevation={0} className="outline-line h-full w-full rounded-4xl py-8 outline -outline-offset-1">
              <Box className="relative h-full w-full overflow-x-hidden">
                <Box
                  style={{ width: leftSecondaryDefaultWidth }}
                  className={cn(
                    "absolute flex h-full min-h-full flex-col gap-2 overflow-y-scroll pr-[1rem] pl-[1.375rem]",
                  )}
                  tabIndex={0}
                  aria-label={t("menu-subnavigation")}
                >
                  {customSecondaryContent ? (
                    customSecondaryContent
                  ) : (
                    <>
                      {activeItem?.label && (
                        <Typography variant="h6" className={"text-primary mb-4 px-2.5"}>
                          {t(activeItem?.label)}
                        </Typography>
                      )}
                      {/* The "compare plans" CTA that used to sit here was
                          unreachable by customers: this panel only renders for
                          a menu item WITH children, and the only one is the
                          superadmin group — so the pitch was shown to the
                          platform operator and to nobody who could buy. The
                          plan surface now lives in the primary rail
                          (<PlanIndicator/>), which every workspace sees. */}
                      <Box className="flex h-full w-full flex-1 flex-col gap-2">
                        {activeItem?.children &&
                          activeItem?.children?.length > 0 &&
                          activeItem?.children?.map((item) => (
                            <SecondaryItem
                              item={item}
                              key={`left-menu-secondary-item-${leftMenuType}-${activeItem.id}-${item.id}`}
                              indent={0}
                              openedAccordions={openedAccordions}
                              setOpenedAccordions={setOpenedAccordions}
                            />
                          ))}
                      </Box>
                    </>
                  )}
                </Box>
              </Box>
            </Paper>
          </Box>
        </Box>
      )}
    </nav>
  );
}
