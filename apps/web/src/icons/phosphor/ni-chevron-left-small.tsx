import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CaretLeft } from "@phosphor-icons/react/dist/ssr";

export default function NiChevronLeftSmall({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CaretLeft className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
