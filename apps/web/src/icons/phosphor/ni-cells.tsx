import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SquaresFour } from "@phosphor-icons/react/dist/ssr";

export default function NiCells({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SquaresFour className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
