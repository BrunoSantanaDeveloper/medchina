import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Clock } from "@phosphor-icons/react/dist/ssr";

export default function NiClock({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Clock className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
