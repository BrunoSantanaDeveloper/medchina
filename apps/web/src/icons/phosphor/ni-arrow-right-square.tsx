import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowSquareRight } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowRightSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowSquareRight
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
