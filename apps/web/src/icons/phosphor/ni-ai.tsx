import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Sparkle } from "@phosphor-icons/react/dist/ssr";

export default function NiAi({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Sparkle className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
