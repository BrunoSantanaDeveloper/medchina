import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowUUpLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiReverseLeft({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowUUpLeft className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
