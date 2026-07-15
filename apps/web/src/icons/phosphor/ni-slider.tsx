import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Faders } from "@phosphor-icons/react/dist/ssr";

export default function NiSlider({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Faders className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
