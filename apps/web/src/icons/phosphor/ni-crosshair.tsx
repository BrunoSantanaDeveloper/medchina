import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Crosshair } from "@phosphor-icons/react/dist/ssr";

export default function NiCrosshair({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Crosshair className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
