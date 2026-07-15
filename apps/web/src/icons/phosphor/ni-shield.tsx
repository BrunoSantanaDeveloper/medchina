import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Shield } from "@phosphor-icons/react/dist/ssr";

export default function NiShield({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Shield className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
