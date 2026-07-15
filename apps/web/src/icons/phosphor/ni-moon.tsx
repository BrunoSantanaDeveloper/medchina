import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Moon } from "@phosphor-icons/react/dist/ssr";

export default function NiMoon({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Moon className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
