import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowsClockwise } from "@phosphor-icons/react/dist/ssr";

export default function NiRefresh({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowsClockwise
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
