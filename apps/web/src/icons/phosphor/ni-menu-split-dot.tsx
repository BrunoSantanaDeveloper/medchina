import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Sidebar } from "@phosphor-icons/react/dist/ssr";

export default function NiMenuSplitDot({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Sidebar className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
