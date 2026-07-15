import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowsOutSimple } from "@phosphor-icons/react/dist/ssr";

export default function NiExpandFull({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowsOutSimple
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
