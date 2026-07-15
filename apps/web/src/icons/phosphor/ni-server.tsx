import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { HardDrives } from "@phosphor-icons/react/dist/ssr";

export default function NiServer({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <HardDrives className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
