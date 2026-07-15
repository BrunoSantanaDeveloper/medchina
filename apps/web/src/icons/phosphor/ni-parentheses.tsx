import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { BracketsRound } from "@phosphor-icons/react/dist/ssr";

export default function NiParentheses({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <BracketsRound
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
