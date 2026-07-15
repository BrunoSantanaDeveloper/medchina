import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowSquareUp } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowUpSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowSquareUp
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
