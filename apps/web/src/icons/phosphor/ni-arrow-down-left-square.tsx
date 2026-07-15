import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowSquareDownLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowDownLeftSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowSquareDownLeft
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
