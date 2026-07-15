import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { PaintBucket } from "@phosphor-icons/react/dist/ssr";

export default function NiPaintBucket({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <PaintBucket className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
