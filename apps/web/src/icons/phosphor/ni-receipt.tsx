import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Receipt } from "@phosphor-icons/react/dist/ssr";

export default function NiReceipt({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Receipt className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
