import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TextUnderline } from "@phosphor-icons/react/dist/ssr";

export default function NiTextUnderline({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <TextUnderline
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
