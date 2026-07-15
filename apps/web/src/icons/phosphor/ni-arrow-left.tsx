import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowLeft({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowLeft className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
