import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Palette } from "@phosphor-icons/react/dist/ssr";

export default function NiPalette({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Palette className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
