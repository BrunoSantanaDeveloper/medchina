import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Headphones } from "@phosphor-icons/react/dist/ssr";

export default function NiHeadphones({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Headphones className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
