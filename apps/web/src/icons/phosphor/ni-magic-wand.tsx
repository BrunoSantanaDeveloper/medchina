import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { MagicWand } from "@phosphor-icons/react/dist/ssr";

export default function NiMagicWand({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <MagicWand className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
