import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

export default function NiSearch({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <MagnifyingGlass
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
