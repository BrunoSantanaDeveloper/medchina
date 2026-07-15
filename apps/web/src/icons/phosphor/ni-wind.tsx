import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Wind } from "@phosphor-icons/react/dist/ssr";

export default function NiWind({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Wind className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
