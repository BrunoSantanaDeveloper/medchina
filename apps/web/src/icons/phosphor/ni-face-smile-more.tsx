import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SmileyWink } from "@phosphor-icons/react/dist/ssr";

export default function NiFaceSmileMore({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SmileyWink className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
