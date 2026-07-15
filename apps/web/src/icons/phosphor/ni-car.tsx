import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Car } from "@phosphor-icons/react/dist/ssr";

export default function NiCar({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Car className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
