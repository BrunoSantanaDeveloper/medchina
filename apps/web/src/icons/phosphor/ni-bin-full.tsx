import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TrashSimple } from "@phosphor-icons/react/dist/ssr";

export default function NiBinFull({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TrashSimple className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
