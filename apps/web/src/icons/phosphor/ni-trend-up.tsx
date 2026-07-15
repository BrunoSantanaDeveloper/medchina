import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TrendUp } from "@phosphor-icons/react/dist/ssr";

export default function NiTrendUp({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TrendUp className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
