import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CurrencyDollarSimple } from "@phosphor-icons/react/dist/ssr";

export default function NiDollarSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CurrencyDollarSimple
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
