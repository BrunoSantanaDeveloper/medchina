import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Lock } from "@phosphor-icons/react/dist/ssr";

export default function NiLock({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Lock className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
