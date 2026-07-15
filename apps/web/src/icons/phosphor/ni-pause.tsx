import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Pause } from "@phosphor-icons/react/dist/ssr";

export default function NiPause({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Pause className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
