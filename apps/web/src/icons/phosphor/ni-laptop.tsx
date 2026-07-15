import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Laptop } from "@phosphor-icons/react/dist/ssr";

export default function NiLaptop({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Laptop className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
