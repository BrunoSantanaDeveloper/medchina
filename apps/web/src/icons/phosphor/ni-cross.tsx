import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { X } from "@phosphor-icons/react/dist/ssr";

export default function NiCross({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <X className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
