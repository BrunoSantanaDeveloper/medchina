import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Basket } from "@phosphor-icons/react/dist/ssr";

export default function NiBasket({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Basket className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
