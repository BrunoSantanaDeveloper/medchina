import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Plus } from "@phosphor-icons/react/dist/ssr";

export default function NiPlus({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Plus className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
