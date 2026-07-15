import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowsInSimple } from "@phosphor-icons/react/dist/ssr";

export default function NiShrinkFull({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowsInSimple
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
