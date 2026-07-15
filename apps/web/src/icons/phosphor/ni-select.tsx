import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SelectionAll } from "@phosphor-icons/react/dist/ssr";

export default function NiSelect({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SelectionAll className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
