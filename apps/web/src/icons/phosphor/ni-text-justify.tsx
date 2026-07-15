import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TextAlignJustify } from "@phosphor-icons/react/dist/ssr";

export default function NiTextJustify({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TextAlignJustify
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
