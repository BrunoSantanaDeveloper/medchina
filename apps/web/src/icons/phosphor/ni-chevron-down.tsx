import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CaretDown } from "@phosphor-icons/react/dist/ssr";

export default function NiChevronDown({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CaretDown className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
