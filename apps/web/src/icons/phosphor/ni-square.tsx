import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Square } from "@phosphor-icons/react/dist/ssr";

export default function NiSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Square className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
