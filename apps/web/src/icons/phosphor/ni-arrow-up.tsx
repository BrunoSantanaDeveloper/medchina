import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowUp } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowUp({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowUp className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
