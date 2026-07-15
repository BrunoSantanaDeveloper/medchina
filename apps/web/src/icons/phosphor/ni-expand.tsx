import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowsOut } from "@phosphor-icons/react/dist/ssr";

export default function NiExpand({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowsOut className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
