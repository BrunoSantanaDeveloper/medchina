import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowRight({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowRight className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
