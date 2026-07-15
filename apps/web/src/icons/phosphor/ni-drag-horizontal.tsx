import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { DotsSixVertical } from "@phosphor-icons/react/dist/ssr";

export default function NiDragHorizontal({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <DotsSixVertical
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
