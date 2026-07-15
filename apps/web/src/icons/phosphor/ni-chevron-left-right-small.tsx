import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowsOutLineHorizontal } from "@phosphor-icons/react/dist/ssr";

export default function NiChevronLeftRightSmall({
  className,
  variant = "outlined",
  size = "medium",
}: NextureIconsProps) {
  return (
    <ArrowsOutLineHorizontal
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
