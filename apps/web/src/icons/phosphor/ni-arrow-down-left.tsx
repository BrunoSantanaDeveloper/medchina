import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowDownLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowDownLeft({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowDownLeft
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
