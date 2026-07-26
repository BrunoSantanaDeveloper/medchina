"use client";

import { Box, Typography } from "@mui/material";

import { cn } from "@/lib/utils";

export type UsageSegment = {
  key: string;
  /** Legend label. */
  label: string;
  /** Share of the total, used for the bar width. */
  value: number;
  /** Preformatted amount shown in the legend (already localized). */
  display: string;
  /**
   * Token-based fill for the bar segment and its legend ring. `secondary`
   * marks a pool that is real but of a different NATURE from the main one
   * (purchased minutes next to cycle minutes) — same weight, different colour,
   * so the bar reads as two things rather than more of the same.
   */
  tone: "primary" | "secondary" | "attention" | "empty";
};

const BAR_TONE: Record<UsageSegment["tone"], string> = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  attention: "bg-accent-3",
  empty: "bg-grey-100",
};

const RING_TONE: Record<UsageSegment["tone"], string> = {
  primary: "border-primary",
  secondary: "border-secondary",
  attention: "border-accent-3",
  empty: "border-grey-200",
};

/**
 * A consumption readout: the headline answer, a segmented bar, and a legend
 * that names every segment with its amount.
 *
 * Why segments instead of a plain progress bar: a single filled bar answers
 * "how full", but the question here is "how much is left, and what did I
 * spend" — two quantities. Naming both in the legend removes the mental
 * arithmetic, and the bar keeps the proportion readable at a glance.
 *
 * Segments with a zero share are dropped from the bar but KEPT in the legend,
 * so "0 min restantes" is stated rather than silently disappearing.
 */
export default function UsageMeter({
  headline,
  caption,
  segments,
  ariaLabel,
}: {
  /** The one-line answer, e.g. "120 de 300 min em uso". */
  headline: string;
  caption?: string;
  segments: UsageSegment[];
  ariaLabel: string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);

  return (
    <Box className="flex flex-col gap-2.5">
      <Typography variant="body2" className="text-text-primary leading-6">
        {headline}
      </Typography>

      <Box className="flex h-2 w-full flex-row items-stretch gap-1 overflow-hidden" aria-label={ariaLabel} role="img">
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <Box
              key={segment.key}
              className={cn("h-full rounded-full", BAR_TONE[segment.tone])}
              // Percentages keep the bar responsive; the floor keeps a tiny but
              // non-zero amount visible instead of collapsing to nothing.
              style={{ width: `${Math.max(2, total > 0 ? (segment.value / total) * 100 : 0)}%` }}
            />
          ))}
      </Box>

      <Box component="ul" className="m-0 flex list-none flex-row flex-wrap gap-x-4 gap-y-1.5 p-0">
        {segments.map((segment) => (
          <Box component="li" key={segment.key} className="flex flex-row items-center gap-1.5">
            <span aria-hidden className={cn("h-3 w-3 flex-none rounded-full border-2", RING_TONE[segment.tone])} />
            <Typography variant="body2" className="text-text-primary text-xs font-medium">
              {segment.label}
            </Typography>
            <Typography variant="body2" className="text-text-secondary text-xs tabular-nums">
              {segment.display}
            </Typography>
          </Box>
        ))}
      </Box>

      {caption && (
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {caption}
        </Typography>
      )}
    </Box>
  );
}
