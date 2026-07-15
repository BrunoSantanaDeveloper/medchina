import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TextItalic } from "@phosphor-icons/react/dist/ssr";

export default function NiTextItalic({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TextItalic className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
