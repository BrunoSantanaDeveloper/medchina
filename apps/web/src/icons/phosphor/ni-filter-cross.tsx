import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FunnelX } from "@phosphor-icons/react/dist/ssr";

export default function NiFilterCross({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FunnelX className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
