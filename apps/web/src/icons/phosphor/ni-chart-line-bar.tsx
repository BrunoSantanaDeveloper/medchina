import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ChartLineUp } from "@phosphor-icons/react/dist/ssr";

export default function NiChartLineBar({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ChartLineUp className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
