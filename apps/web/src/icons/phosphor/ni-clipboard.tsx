import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ClipboardText } from "@phosphor-icons/react/dist/ssr";

export default function NiClipboard({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ClipboardText
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
