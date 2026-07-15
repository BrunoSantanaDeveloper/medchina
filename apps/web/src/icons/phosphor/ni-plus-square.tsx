import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { PlusSquare } from "@phosphor-icons/react/dist/ssr";

export default function NiPlusSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <PlusSquare className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
