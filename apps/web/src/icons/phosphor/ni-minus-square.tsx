import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { MinusSquare } from "@phosphor-icons/react/dist/ssr";

export default function NiMinusSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <MinusSquare className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
