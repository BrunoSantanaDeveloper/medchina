import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";

export default function NiShieldCheck({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ShieldCheck className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
