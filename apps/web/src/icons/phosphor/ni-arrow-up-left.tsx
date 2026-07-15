import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowUpLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowUpLeft({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowUpLeft className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
