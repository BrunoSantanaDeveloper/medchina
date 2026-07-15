import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { At } from "@phosphor-icons/react/dist/ssr";

export default function NiAt({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <At className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
