import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SmileyXEyes } from "@phosphor-icons/react/dist/ssr";

export default function NiFaceFrownMore({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SmileyXEyes className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
