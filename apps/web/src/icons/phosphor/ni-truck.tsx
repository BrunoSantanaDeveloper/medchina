import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Truck } from "@phosphor-icons/react/dist/ssr";

export default function NiTruck({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Truck className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
