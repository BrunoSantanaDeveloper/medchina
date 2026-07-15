import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Eraser } from "@phosphor-icons/react/dist/ssr";

export default function NiEraser({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Eraser className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
