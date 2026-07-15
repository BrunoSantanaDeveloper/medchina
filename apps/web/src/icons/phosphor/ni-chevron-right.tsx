import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CaretRight } from "@phosphor-icons/react/dist/ssr";

export default function NiChevronRight({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CaretRight className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
