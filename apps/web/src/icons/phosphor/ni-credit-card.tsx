import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CreditCard } from "@phosphor-icons/react/dist/ssr";

export default function NiCreditCard({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CreditCard className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
