import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowCircleRight } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowCircleRight({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowCircleRight
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
