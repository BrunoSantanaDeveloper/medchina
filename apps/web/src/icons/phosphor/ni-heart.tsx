import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Heart } from "@phosphor-icons/react/dist/ssr";

export default function NiHeart({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Heart className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
