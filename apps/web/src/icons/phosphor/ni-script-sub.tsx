import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TextSubscript } from "@phosphor-icons/react/dist/ssr";

export default function NiScriptSub({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TextSubscript
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
