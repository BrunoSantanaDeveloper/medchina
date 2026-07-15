import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Lightning } from "@phosphor-icons/react/dist/ssr";

export default function NiFlash({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Lightning className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
