import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ThumbsUp } from "@phosphor-icons/react/dist/ssr";

export default function NiLike({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ThumbsUp className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
