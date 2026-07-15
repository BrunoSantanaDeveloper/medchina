import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { MapPin } from "@phosphor-icons/react/dist/ssr";

export default function NiPin({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <MapPin className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
