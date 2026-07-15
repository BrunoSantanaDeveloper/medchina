import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { PaintBrush } from "@phosphor-icons/react/dist/ssr";

export default function NiBrush({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <PaintBrush className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
