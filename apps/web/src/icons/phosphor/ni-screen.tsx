import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Monitor } from "@phosphor-icons/react/dist/ssr";

export default function NiScreen({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Monitor className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
