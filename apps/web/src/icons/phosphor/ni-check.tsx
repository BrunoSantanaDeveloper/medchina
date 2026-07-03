import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Check } from "@phosphor-icons/react/dist/ssr";

export default function NiCheck({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Check className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
