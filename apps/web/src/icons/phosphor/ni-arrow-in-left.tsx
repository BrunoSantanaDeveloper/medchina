import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowLineLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowInLeft({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowLineLeft
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
