import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { DeviceTablet } from "@phosphor-icons/react/dist/ssr";

export default function NiTablet({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <DeviceTablet className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
