import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowsLeftRight } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowLeftRight({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowsLeftRight
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
