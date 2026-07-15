import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Crop } from "@phosphor-icons/react/dist/ssr";

export default function NiCrop({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Crop className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
