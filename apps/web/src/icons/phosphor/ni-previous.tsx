import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SkipBack } from "@phosphor-icons/react/dist/ssr";

export default function NiPrevious({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SkipBack className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
