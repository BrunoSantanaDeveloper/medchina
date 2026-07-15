import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Share } from "@phosphor-icons/react/dist/ssr";

export default function NiShare({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Share className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
