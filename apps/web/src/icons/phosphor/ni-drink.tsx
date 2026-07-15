import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Martini } from "@phosphor-icons/react/dist/ssr";

export default function NiDrink({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Martini className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
