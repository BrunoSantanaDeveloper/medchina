import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FloppyDisk } from "@phosphor-icons/react/dist/ssr";

export default function NiFloppyDisk({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FloppyDisk className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
