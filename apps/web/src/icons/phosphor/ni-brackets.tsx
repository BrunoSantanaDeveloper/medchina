import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { BracketsSquare } from "@phosphor-icons/react/dist/ssr";

export default function NiBrackets({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <BracketsSquare
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
