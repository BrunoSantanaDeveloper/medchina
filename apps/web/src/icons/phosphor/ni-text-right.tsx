import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TextAlignRight } from "@phosphor-icons/react/dist/ssr";

export default function NiTextRight({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TextAlignRight
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
