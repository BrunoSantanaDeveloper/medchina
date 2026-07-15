import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SmileyMeh } from "@phosphor-icons/react/dist/ssr";

export default function NiFaceNeutral({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SmileyMeh className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
