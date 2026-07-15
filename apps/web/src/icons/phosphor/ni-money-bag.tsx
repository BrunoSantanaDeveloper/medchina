import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { MoneyWavy } from "@phosphor-icons/react/dist/ssr";

export default function NiMoneyBag({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <MoneyWavy className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
