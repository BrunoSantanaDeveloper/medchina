import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { DotsNine } from "@phosphor-icons/react/dist/ssr";

export default function NiDotsSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <DotsNine className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
