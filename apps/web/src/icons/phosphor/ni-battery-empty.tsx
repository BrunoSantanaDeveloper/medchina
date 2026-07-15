import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { BatteryEmpty } from "@phosphor-icons/react/dist/ssr";

export default function NiBatteryEmpty({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <BatteryEmpty className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
