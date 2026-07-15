import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { BracketsCurly } from "@phosphor-icons/react/dist/ssr";

export default function NiBraces({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <BracketsCurly
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
