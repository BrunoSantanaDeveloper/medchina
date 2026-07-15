import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowSquareLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowLeftSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowSquareLeft
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
