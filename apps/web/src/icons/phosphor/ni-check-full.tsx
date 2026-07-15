import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CheckCircle } from "@phosphor-icons/react/dist/ssr";

export default function NiCheckFull({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CheckCircle className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
