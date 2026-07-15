import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ListNumbers } from "@phosphor-icons/react/dist/ssr";

export default function NiListNumber({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ListNumbers className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
