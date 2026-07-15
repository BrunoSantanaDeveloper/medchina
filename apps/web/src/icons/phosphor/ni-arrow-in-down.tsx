import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowLineDown } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowInDown({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowLineDown
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
