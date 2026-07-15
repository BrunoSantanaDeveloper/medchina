import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { DotsSix } from "@phosphor-icons/react/dist/ssr";

export default function NiDragVertical({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <DotsSix className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
