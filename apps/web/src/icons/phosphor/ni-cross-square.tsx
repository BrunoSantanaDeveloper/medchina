import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { XSquare } from "@phosphor-icons/react/dist/ssr";

export default function NiCrossSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <XSquare className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
