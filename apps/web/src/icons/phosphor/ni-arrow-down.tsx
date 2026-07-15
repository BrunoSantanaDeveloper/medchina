import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowDown } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowDown({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowDown className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
