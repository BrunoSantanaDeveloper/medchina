import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Coin } from "@phosphor-icons/react/dist/ssr";

export default function NiCoin({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Coin className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
