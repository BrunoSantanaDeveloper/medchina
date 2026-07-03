import { useAxesTooltip, useItemTooltip } from "@mui/x-charts-pro";

import { tooltipHooksToDataset } from "@/lib/chart-helper";

export default function useChartTooltipDataPro(trigger: "axis" | "item" | "none" = "axis") {
  const axesTooltip = useAxesTooltip();
  const itemTooltip = useItemTooltip();

  return tooltipHooksToDataset({ axesTooltip, itemTooltip, trigger });
}
