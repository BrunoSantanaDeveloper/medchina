import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowSquareUpRight } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowUpRightSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowSquareUpRight
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
