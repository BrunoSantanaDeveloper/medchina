import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ThumbsDown } from "@phosphor-icons/react/dist/ssr";

export default function NiUnlike({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ThumbsDown className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
