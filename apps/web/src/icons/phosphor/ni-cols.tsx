import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Columns } from "@phosphor-icons/react/dist/ssr";

export default function NiCols({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Columns className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
