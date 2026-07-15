import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowDownRight } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowDownRight({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowDownRight
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
