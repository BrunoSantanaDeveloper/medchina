import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Bluetooth } from "@phosphor-icons/react/dist/ssr";

export default function NiBluetooth({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Bluetooth className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
