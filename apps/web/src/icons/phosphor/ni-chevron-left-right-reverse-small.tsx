import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowsInLineHorizontal } from "@phosphor-icons/react/dist/ssr";

export default function NiChevronLeftRightReverseSmall({
  className,
  variant = "outlined",
  size = "medium",
}: NextureIconsProps) {
  return (
    <ArrowsInLineHorizontal
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
