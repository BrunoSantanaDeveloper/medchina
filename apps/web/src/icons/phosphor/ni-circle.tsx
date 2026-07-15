import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Circle } from "@phosphor-icons/react/dist/ssr";

export default function NiCircle({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Circle className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
