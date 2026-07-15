import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowsIn } from "@phosphor-icons/react/dist/ssr";

export default function NiCollapse({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowsIn className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
