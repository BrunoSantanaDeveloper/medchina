import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { WarningCircle } from "@phosphor-icons/react/dist/ssr";

export default function NiExclamationHexagon({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <WarningCircle
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
