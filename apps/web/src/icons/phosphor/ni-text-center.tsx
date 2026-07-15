import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TextAlignCenter } from "@phosphor-icons/react/dist/ssr";

export default function NiTextCenter({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TextAlignCenter
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
