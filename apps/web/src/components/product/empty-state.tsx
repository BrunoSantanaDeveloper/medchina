"use client";

import Link from "next/link";

import { Box, Button, Typography } from "@mui/material";

import { cn } from "@/lib/utils";

type Action = { label: string; href?: string; onClick?: () => void };

/**
 * An empty state is NEVER a blank screen. It answers three things at a
 * glance: what this area is, why it's empty, and the ONE next action that
 * fills it (the nudge). Use it for every zero-data view (product-screen
 * skill rule) — a bare "No data" is a UX failure.
 *
 * A section or a list with nothing in it is never left as empty space
 * either (the owner, 2026-11-09): it takes an `illustration` (one of
 * `@/icons/illustrations/*`, the template's line drawings, in the secondary
 * hue), as the template's own empty cards do. `layout="row"` puts the drawing
 * beside the words, for a short band across the page; `framed={false}` drops
 * the dashed frame inside a card (or a grid) that frames it already. A state
 * of permission or of a failed read keeps its `icon`.
 */
export default function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  secondaryAction,
  className,
  titleAs = "h2",
  layout = "stack",
  framed = true,
}: {
  /** Meaningful icon (the concept, in a soft tinted chip). An `illustration`, when given, takes its place. */
  icon?: React.ReactNode;
  /** The drawing of what the empty section is about, as `<IllustrationLaunch />`: it fills the space. */
  illustration?: React.ReactNode;
  title: string;
  description?: string;
  /** The primary nudge — what the user should do to get value here. */
  action?: Action;
  secondaryAction?: Action;
  className?: string;
  /** The title's heading level, under the heading of the section it sits in: h2 on a page, h3 in a card. */
  titleAs?: "h2" | "h3" | "h4";
  /** The drawing above the words (a card, a section) or beside them (a short band). */
  layout?: "stack" | "row";
  /** The dashed frame of a zero-data area on a page; inside a card or a grid, none. */
  framed?: boolean;
}) {
  const renderAction = (a: Action, variant: "contained" | "outlined" | "text") =>
    a.href ? (
      <Button variant={variant} color={variant === "text" ? "grey" : "primary"} href={a.href} LinkComponent={Link}>
        {a.label}
      </Button>
    ) : (
      <Button variant={variant} color={variant === "text" ? "grey" : "primary"} onClick={a.onClick}>
        {a.label}
      </Button>
    );
  const row = layout === "row";
  // With a drawing, the nudge is outlined, as on the template's empty cards: the drawing is what draws the eye.
  const primary = illustration ? "outlined" : "contained";

  return (
    <Box
      className={cn(
        "flex items-center gap-3",
        row ? "flex-col text-center sm:flex-row sm:gap-8 sm:text-left" : "flex-col text-center",
        framed && "border-grey-100 rounded-3xl border border-dashed px-6",
        framed ? (row ? "py-8" : "py-14") : "py-4",
        className,
      )}
    >
      {illustration ? (
        <span
          aria-hidden
          className={cn(
            "text-secondary flex flex-none items-center justify-center [&_svg]:w-auto [&_svg]:max-w-full [&_svg]:overflow-visible",
            row ? "[&_svg]:h-28" : "[&_svg]:h-40",
          )}
        >
          {illustration}
        </span>
      ) : icon ? (
        <span className="bg-primary/10 text-primary flex h-14 w-14 items-center justify-center rounded-2xl [&_svg]:h-7 [&_svg]:w-7">
          {icon}
        </span>
      ) : null}
      <Box className={cn("flex flex-col gap-3", row ? "items-center sm:items-start" : "items-center")}>
        <Typography variant="h5" component={titleAs} className="text-text-primary mt-1 mb-0">
          {title}
        </Typography>
        {description && (
          <Typography variant="body1" className="text-text-secondary max-w-md leading-6">
            {description}
          </Typography>
        )}
        {(action || secondaryAction) && (
          <Box className={cn("flex flex-col items-center gap-2 sm:flex-row", row ? "mt-1 sm:items-start" : "mt-3")}>
            {action && renderAction(action, primary)}
            {secondaryAction && renderAction(secondaryAction, "text")}
          </Box>
        )}
      </Box>
    </Box>
  );
}
