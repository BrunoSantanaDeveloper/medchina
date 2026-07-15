import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr";

export default function NiEllipsisVertical({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <DotsThreeVertical
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
