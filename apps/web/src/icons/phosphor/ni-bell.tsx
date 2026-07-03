import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Bell } from "@phosphor-icons/react/dist/ssr";

export default function NiBell({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Bell className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
