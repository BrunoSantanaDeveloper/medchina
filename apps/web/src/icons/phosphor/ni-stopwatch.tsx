import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Timer } from "@phosphor-icons/react/dist/ssr";

export default function NiStopwatch({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Timer className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
