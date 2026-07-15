import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { MagnifyingGlassMinus } from "@phosphor-icons/react/dist/ssr";

export default function NiZoomOut({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <MagnifyingGlassMinus
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
