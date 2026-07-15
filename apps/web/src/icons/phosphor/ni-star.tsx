import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Star } from "@phosphor-icons/react/dist/ssr";

export default function NiStar({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Star className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
