import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TextStrikethrough } from "@phosphor-icons/react/dist/ssr";

export default function NiTextStrikethrough({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TextStrikethrough
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
