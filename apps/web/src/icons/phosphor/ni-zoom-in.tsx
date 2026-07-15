import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { MagnifyingGlassPlus } from "@phosphor-icons/react/dist/ssr";

export default function NiZoomIn({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <MagnifyingGlassPlus
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
