import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { PenNib } from "@phosphor-icons/react/dist/ssr";

export default function NiPen({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <PenNib className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
