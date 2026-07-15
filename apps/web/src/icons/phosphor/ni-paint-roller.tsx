import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { PaintRoller } from "@phosphor-icons/react/dist/ssr";

export default function NiPaintRoller({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <PaintRoller className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
