import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { BookOpen } from "@phosphor-icons/react/dist/ssr";

export default function NiBook({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <BookOpen className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
