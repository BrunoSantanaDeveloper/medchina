import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SkipForward } from "@phosphor-icons/react/dist/ssr";

export default function NiNext({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SkipForward className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
