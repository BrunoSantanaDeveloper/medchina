import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CaretUpDown } from "@phosphor-icons/react/dist/ssr";

export default function NiChevronUpDownSmall({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CaretUpDown className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
