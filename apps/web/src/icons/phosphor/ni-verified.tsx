import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SealCheck } from "@phosphor-icons/react/dist/ssr";

export default function NiVerified({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SealCheck className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
