import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TrendDown } from "@phosphor-icons/react/dist/ssr";

export default function NiTrendDown({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TrendDown className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
