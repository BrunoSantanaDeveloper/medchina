import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SelectionPlus } from "@phosphor-icons/react/dist/ssr";

export default function NiGroup({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SelectionPlus
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
