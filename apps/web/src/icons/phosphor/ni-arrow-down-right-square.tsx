import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowSquareDownRight } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowDownRightSquare({
  className,
  variant = "outlined",
  size = "medium",
}: NextureIconsProps) {
  return (
    <ArrowSquareDownRight
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
