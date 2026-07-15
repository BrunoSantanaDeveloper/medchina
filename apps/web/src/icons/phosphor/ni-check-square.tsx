import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CheckSquare } from "@phosphor-icons/react/dist/ssr";

export default function NiCheckSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CheckSquare className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
