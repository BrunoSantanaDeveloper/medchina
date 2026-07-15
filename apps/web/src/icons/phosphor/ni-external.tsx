import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";

export default function NiExternal({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ArrowSquareOut
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
