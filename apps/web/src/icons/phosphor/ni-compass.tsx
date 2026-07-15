import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Compass } from "@phosphor-icons/react/dist/ssr";

export default function NiCompass({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Compass className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
