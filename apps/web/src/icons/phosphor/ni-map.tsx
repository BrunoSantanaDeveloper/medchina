import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { MapTrifold } from "@phosphor-icons/react/dist/ssr";

export default function NiMap({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <MapTrifold className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
