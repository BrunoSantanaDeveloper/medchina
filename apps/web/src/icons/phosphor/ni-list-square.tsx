import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ListDashes } from "@phosphor-icons/react/dist/ssr";

export default function NiListSquare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ListDashes className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
