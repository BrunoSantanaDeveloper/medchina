import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowUUpRight } from "@phosphor-icons/react/dist/ssr";

export default function NiReverseRight({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowUUpRight
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
