import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ChefHat } from "@phosphor-icons/react/dist/ssr";

export default function NiChef({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ChefHat className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
