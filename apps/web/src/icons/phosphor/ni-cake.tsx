import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Cake } from "@phosphor-icons/react/dist/ssr";

export default function NiCake({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Cake className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
