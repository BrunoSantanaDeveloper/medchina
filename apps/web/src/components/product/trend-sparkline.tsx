"use client";

import { Box, Typography, useTheme } from "@mui/material";
import { SparkLineChart } from "@mui/x-charts";

import useHighlightedSparkline from "@/hooks/use-highlighted-sparkline";
import NiTriangleDown from "@/icons/nexture/ni-triangle-down";
import NiTriangleUp from "@/icons/nexture/ni-triangle-up";

/**
 * The template's stat-with-sparkline (dashboards/default/sections/
 * dashboard-default-stats.tsx): the highlighted point's value in `h5`, its
 * change against the previous point, and the series drawn underneath. Hovering
 * moves the highlight, so every point is readable without a table.
 *
 * Use it when the payload already carries a SERIES. A trend answers "is this
 * going up or down", which a single number cannot — but only when there are
 * real points behind it; never synthesize one to decorate a screen.
 *
 * The decline reads terracotta rather than red, for the same reason the audio
 * and library meters do (docs/DESIGN.md): red belongs to clinical risk and
 * failure, and a falling count is a signal to act, not a failure.
 */
export default function TrendSparkline({
  label,
  data,
  plotType = "bar",
  /** Formats the highlighted value, e.g. minutes or currency. */
  formatValue,
  caption,
  tone = "primary",
}: {
  label: string;
  /** At least one point. An empty series must not reach this component. */
  data: number[];
  plotType?: "line" | "bar";
  formatValue?: (value: number) => string;
  caption?: string;
  tone?: "primary" | "secondary";
}) {
  const { palette } = useTheme();
  // The hook derives its y-axis from the data, so a defensive floor keeps an
  // accidental empty series from producing -Infinity instead of a chart.
  const series = data.length > 0 ? data : [0];
  const sparkline = useHighlightedSparkline({
    data: series,
    plotType,
    color: tone === "secondary" ? palette.secondary.main : palette.primary.main,
  });

  const change = Number(sparkline.item.change);
  const rising = change > 0;
  const falling = change < 0;

  return (
    <Box className="flex flex-col gap-2">
      <Box className="flex flex-col">
        <Typography variant="body1" className="text-text-secondary leading-5">
          {label}
        </Typography>
        <Box className="flex flex-row items-center gap-2">
          <Typography variant="h5" component="p" className="text-text-primary tabular-nums">
            {formatValue ? formatValue(sparkline.item.value) : sparkline.item.value}
          </Typography>
          {(rising || falling) && (
            <Box className="flex flex-row items-center">
              {rising ? (
                <NiTriangleUp className="text-success" size="medium" />
              ) : (
                <NiTriangleDown className="text-accent-3" size="medium" />
              )}
              <Typography variant="body2" className={rising ? "text-success" : "text-accent-3"}>
                {Math.abs(change)}%
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
      <SparkLineChart {...sparkline.props} />
      {caption && (
        <Typography variant="body2" className="text-text-secondary">
          {caption}
        </Typography>
      )}
    </Box>
  );
}
