import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CurrencyEur } from "@phosphor-icons/react/dist/ssr";

export default function NiEuro({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CurrencyEur className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
