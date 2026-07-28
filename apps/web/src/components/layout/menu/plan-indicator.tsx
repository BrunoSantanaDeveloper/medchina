"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useTranslations } from "use-intl";

import { Box, Typography } from "@mui/material";

import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiBadge from "@/icons/nexture/ni-badge";
import { getProductAction } from "@/lib/product-actions";
import { trackCommercialEvent } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { MenuType } from "@/types";

const BILLING_HREF = `${getProductAction("billing").href}?source=menu&feature=plans`;

/**
 * The workspace's current plan, at the foot of the nav rail.
 *
 * Deliberately a STATE READOUT, not a promotion. The product already sells at
 * the moment of need (recorder, reasoning panel, usage meter at 80/95/100%),
 * and PRD §7.4 asks for controlled frequency — an ambient "UPGRADE NOW" in
 * chrome that is on screen while a patient is in the room is exactly the nag
 * that asks for. What was missing is the opposite: a free workspace had no
 * quiet, permanent way to learn the paid tiers exist. So this names the plan,
 * and only adds a "compare plans" line when there is in fact something to buy.
 *
 * The plan comes from `org_audio_allowance` — the same single source the
 * capture gate uses (root CLAUDE.md); querying subscriptions here would create
 * a second opinion about the same workspace. The menu lives in the persistent
 * dashboard layout, so this is one RPC per page load, not per navigation.
 */
export default function PlanIndicator({ menuType }: { menuType: MenuType }) {
  const t = useTranslations("dashboard");
  const { orgId } = useCurrentOrg();
  const { allowance, loading } = useAudioAllowance(orgId);
  const viewTracked = useRef(false);

  // A paid workspace has nothing to buy here: the commercial funnel must not
  // count it as an impression, or the surface's conversion rate is diluted by
  // people it was never addressed to (which is how the old menu CTA reported
  // views from superadmins).
  const sellable = Boolean(allowance) && allowance!.source !== "plan";

  useEffect(() => {
    if (!sellable || viewTracked.current) return;
    viewTracked.current = true;
    trackCommercialEvent("upgrade.prompt_viewed", "menu", "plans");
  }, [sellable]);

  if (loading || !allowance) return null;

  const planLabel =
    allowance.source === "plan"
      ? (allowance.planName ?? t("menu-plan-active"))
      : allowance.source === "trial"
        ? t("menu-plan-trial")
        : t("menu-plan-free");
  const title = t("menu-plan-current", { plan: planLabel });
  const minimal = menuType === MenuType.Minimal;

  return (
    <Box
      component={Link}
      href={BILLING_HREF}
      title={minimal ? title : undefined}
      aria-label={title}
      onClick={() => {
        if (sellable) trackCommercialEvent("upgrade.prompt_clicked", "menu", "plans");
      }}
      className={cn(
        "hover:bg-grey-25 flex w-full flex-col items-center gap-0.5 rounded-2xl px-2 py-2 transition-colors",
        minimal && "px-0",
      )}
    >
      <Box className="text-text-secondary flex flex-row items-center gap-1.5">
        <NiBadge size="small" aria-hidden />
        {!minimal && (
          <Typography variant="body2" className="text-text-primary text-xs leading-4 font-semibold">
            {planLabel}
          </Typography>
        )}
      </Box>
      {/* Only when there is something to buy — a Pro subscriber reading
          "compare plans" every day is noise, not information. */}
      {!minimal && sellable && (
        <Typography
          variant="body2"
          className="text-primary dark:text-primary-light text-center text-[0.6875rem] leading-4"
        >
          {t("menu-cta-button")}
        </Typography>
      )}
    </Box>
  );
}
