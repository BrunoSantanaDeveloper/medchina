import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Coffee } from "@phosphor-icons/react/dist/ssr";

export default function NiCoffee({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Coffee className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
