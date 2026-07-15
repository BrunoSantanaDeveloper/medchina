import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TextSuperscript } from "@phosphor-icons/react/dist/ssr";

export default function NiScriptSuper({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TextSuperscript
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
