import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ChartBar } from "@phosphor-icons/react/dist/ssr";

export default function NiChartBar({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ChartBar className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
