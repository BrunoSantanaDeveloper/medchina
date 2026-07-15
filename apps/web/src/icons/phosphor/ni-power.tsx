import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Power } from "@phosphor-icons/react/dist/ssr";

export default function NiPower({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Power className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
