import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Scissors } from "@phosphor-icons/react/dist/ssr";

export default function NiScissors({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Scissors className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
