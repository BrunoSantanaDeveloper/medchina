import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowSquareUpLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowUpLeftSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowSquareUpLeft
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
