import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SlidersHorizontal } from "@phosphor-icons/react/dist/ssr";

export default function NiKnobs({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SlidersHorizontal
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
