import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { PlusCircle } from "@phosphor-icons/react/dist/ssr";

export default function NiPlusFull({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <PlusCircle className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
