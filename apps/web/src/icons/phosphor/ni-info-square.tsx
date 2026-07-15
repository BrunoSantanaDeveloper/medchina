import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Info } from "@phosphor-icons/react/dist/ssr";

export default function NiInfoSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Info className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
