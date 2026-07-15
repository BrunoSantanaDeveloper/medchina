import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FunnelSimple } from "@phosphor-icons/react/dist/ssr";

export default function NiFilterPlus({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FunnelSimple className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
