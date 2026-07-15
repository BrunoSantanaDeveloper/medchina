import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Cloud } from "@phosphor-icons/react/dist/ssr";

export default function NiCloud({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Cloud className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
