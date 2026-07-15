import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Tag } from "@phosphor-icons/react/dist/ssr";

export default function NiTag({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Tag className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
