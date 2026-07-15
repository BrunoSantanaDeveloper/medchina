import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Handbag } from "@phosphor-icons/react/dist/ssr";

export default function NiBag({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Handbag className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
