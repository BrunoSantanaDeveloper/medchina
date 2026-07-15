import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Percent } from "@phosphor-icons/react/dist/ssr";

export default function NiPercent({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Percent className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
