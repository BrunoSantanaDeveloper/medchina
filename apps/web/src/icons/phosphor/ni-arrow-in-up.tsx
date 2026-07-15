import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowLineUp } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowInUp({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowLineUp className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
