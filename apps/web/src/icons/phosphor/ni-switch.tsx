import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ToggleLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiSwitch({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ToggleLeft className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
