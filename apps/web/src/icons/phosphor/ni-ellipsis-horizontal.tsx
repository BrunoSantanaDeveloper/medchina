import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { DotsThree } from "@phosphor-icons/react/dist/ssr";

export default function NiEllipsisHorizontal({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <DotsThree className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
