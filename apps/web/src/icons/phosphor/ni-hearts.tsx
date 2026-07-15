import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { HeartStraight } from "@phosphor-icons/react/dist/ssr";

export default function NiHearts({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <HeartStraight
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
