import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { BatteryFull } from "@phosphor-icons/react/dist/ssr";

export default function NiBatteryFull({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <BatteryFull className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
