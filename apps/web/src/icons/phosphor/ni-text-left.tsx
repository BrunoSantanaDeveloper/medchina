import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TextAlignLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiTextLeft({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TextAlignLeft
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
