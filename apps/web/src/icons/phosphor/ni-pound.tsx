import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CurrencyGbp } from "@phosphor-icons/react/dist/ssr";

export default function NiPound({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CurrencyGbp className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
