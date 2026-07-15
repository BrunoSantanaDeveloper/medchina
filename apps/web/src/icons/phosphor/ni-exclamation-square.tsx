import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { WarningDiamond } from "@phosphor-icons/react/dist/ssr";

export default function NiExclamationSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <WarningDiamond
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
