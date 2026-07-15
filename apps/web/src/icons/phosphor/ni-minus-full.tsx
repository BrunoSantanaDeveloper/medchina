import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { MinusCircle } from "@phosphor-icons/react/dist/ssr";

export default function NiMinusFull({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <MinusCircle className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
