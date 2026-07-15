import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { LockOpen } from "@phosphor-icons/react/dist/ssr";

export default function NiUnlock({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <LockOpen className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
