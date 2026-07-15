import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Camera } from "@phosphor-icons/react/dist/ssr";

export default function NiCamera({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Camera className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
