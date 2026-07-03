import { useAxesTooltip, useItemTooltip } from "@mui/x-charts";

import { tooltipHooksToDataset } from "@/lib/chart-helper";

export default function useChartTooltipData(trigger: "axis" | "item" | "none" = "axis") {
  const axesTooltip = useAxesTooltip();
  const itemTooltip = useItemTooltip();

  return tooltipHooksToDataset({ axesTooltip, itemTooltip, trigger });
}
