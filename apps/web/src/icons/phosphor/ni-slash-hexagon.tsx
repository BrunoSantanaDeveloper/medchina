import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Prohibit } from "@phosphor-icons/react/dist/ssr";

export default function NiSlashHexagon({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Prohibit className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
