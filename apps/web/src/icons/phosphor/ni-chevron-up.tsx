import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CaretUp } from "@phosphor-icons/react/dist/ssr";

export default function NiChevronUp({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CaretUp className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
