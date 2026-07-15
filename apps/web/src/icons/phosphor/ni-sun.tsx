import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Sun } from "@phosphor-icons/react/dist/ssr";

export default function NiSun({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Sun className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
