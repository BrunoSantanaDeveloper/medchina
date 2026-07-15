import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowCircleLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowCircleLeft({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowCircleLeft
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
