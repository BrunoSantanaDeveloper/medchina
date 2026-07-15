import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ShieldSlash } from "@phosphor-icons/react/dist/ssr";

export default function NiShieldCross({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ShieldSlash className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
