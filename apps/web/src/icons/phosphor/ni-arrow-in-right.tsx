import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowLineRight } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowInRight({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowLineRight
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
