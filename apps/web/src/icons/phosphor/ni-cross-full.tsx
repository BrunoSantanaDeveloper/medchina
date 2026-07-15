import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { XCircle } from "@phosphor-icons/react/dist/ssr";

export default function NiCrossFull({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <XCircle className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
