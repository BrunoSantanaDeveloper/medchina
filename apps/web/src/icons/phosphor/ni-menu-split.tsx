import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SidebarSimple } from "@phosphor-icons/react/dist/ssr";

export default function NiMenuSplit({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SidebarSimple
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
