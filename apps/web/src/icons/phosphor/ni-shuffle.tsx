import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Shuffle } from "@phosphor-icons/react/dist/ssr";

export default function NiShuffle({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Shuffle className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
