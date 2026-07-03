import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { House } from "@phosphor-icons/react/dist/ssr";

export default function NiHome({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <House className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
