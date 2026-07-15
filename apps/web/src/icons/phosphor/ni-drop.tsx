import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Drop } from "@phosphor-icons/react/dist/ssr";

export default function NiDrop({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Drop className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
