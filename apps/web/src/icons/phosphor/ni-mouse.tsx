import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Mouse } from "@phosphor-icons/react/dist/ssr";

export default function NiMouse({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Mouse className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
