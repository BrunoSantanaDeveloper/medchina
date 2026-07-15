import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowsDownUp } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowUpDown({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowsDownUp className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
