import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowSquareIn } from "@phosphor-icons/react/dist/ssr";

export default function NiInternal({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowSquareIn
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
