import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CurrencyDollar } from "@phosphor-icons/react/dist/ssr";

export default function NiDollar({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CurrencyDollar
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
