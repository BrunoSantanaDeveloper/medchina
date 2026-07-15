import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TreeStructure } from "@phosphor-icons/react/dist/ssr";

export default function NiStructure({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TreeStructure
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
