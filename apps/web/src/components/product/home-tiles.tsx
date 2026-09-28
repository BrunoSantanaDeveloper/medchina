"use client";

import Link from "next/link";

import { Box, Card, CardContent, Typography } from "@mui/material";

import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import { cn } from "@/lib/utils";

/**
 * The template's quick-action card, verbatim: a full-height tinted icon
 * column (w-16, rounded-2xl, `-light/10` tint), a semibold title and a
 * one-line description in body size. Four of these share a row on desktop.
 */
export function QuickActionTile({
  href,
  icon,
  tone,
  title,
  description,
}: {
  href: string;
  /** Pass the icon at `size="large"` — 24px inside the 64px column. */
  icon: React.ReactNode;
  tone: TileTone;
  title: string;
  description: string;
}) {
  const style = TILE_TONE[tone];
  return (
    <Card component={Link} href={href} className="flex h-full flex-row p-1 transition-transform hover:scale-[1.02]">
      <Box
        aria-hidden
        className={cn("flex w-16 flex-none items-center justify-center rounded-2xl", style.bg, style.text)}
      >
        {icon}
      </Box>
      <CardContent className="min-w-0">
        <Typography variant="subtitle2" component="p" className="leading-5">
          {title}
        </Typography>
        <Typography variant="body1" className="text-text-secondary line-clamp-1 leading-5">
          {description}
        </Typography>
      </CardContent>
    </Card>
  );
}

/**
 * The template's stats tile: a wide tinted band with the icon, then a
 * secondary label and the value in h5. No trend arrows and no percentages —
 * every number here is a real count the page already loaded (PRD: nothing
 * invented on the home).
 */
export function StatTile({
  href,
  onClick,
  pressed,
  hint,
  icon,
  tone,
  label,
  value,
}: {
  /** A tile that navigates. Give this OR `onClick`, never both — or neither, for a plain readout. */
  href?: string;
  /** A tile that filters the screen it sits on. Renders as a real button and
   *  carries `aria-pressed`, so a keyboard and a screen reader get the same
   *  toggle the eye gets. */
  onClick?: () => void;
  pressed?: boolean;
  /** One line explaining what the count counts, on hover and to assistive tech. */
  hint?: string;
  /** Pass the icon at `size="large"`. */
  icon: React.ReactNode;
  tone: TileTone;
  label: string;
  value: number | string;
}) {
  const style = TILE_TONE[tone];
  // The template's shape is the same either way; only what the card IS changes.
  // A filter is a button, a shortcut is a link — never a div with a click. With
  // neither, the tile is a plain readout: a link to "#" would be a control that
  // goes nowhere.
  const shell = onClick
    ? { component: "button" as const, type: "button" as const, onClick, "aria-pressed": pressed }
    : href
      ? { component: Link, href }
      : { component: "div" as const };
  return (
    <Card
      {...shell}
      title={hint}
      className={cn(
        "flex h-full w-full flex-col p-1 text-left",
        // Only a control grows under the pointer; a readout does not invite a click.
        (onClick || href) && "transition-transform hover:scale-[1.02]",
        onClick && "cursor-pointer",
        // The pressed tile keeps the template's card and gains the ring the
        // rest of the app uses for selection. Measured: a tinted fill alone
        // sits at 1.06:1 against paper, which nobody can see.
        pressed && "outline-primary outline-2 -outline-offset-2",
      )}
    >
      <Box
        aria-hidden
        className={cn("flex h-[4.5rem] w-full flex-none items-center justify-center rounded-2xl", style.bg, style.text)}
      >
        {icon}
      </Box>
      <CardContent className="w-full text-center">
        <Typography variant="body1" className="text-text-secondary leading-5">
          {label}
        </Typography>
        <Typography variant="h5" component="p" className="tabular-nums">
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}
