import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { GenderMale } from "@phosphor-icons/react/dist/ssr";

export default function NiMale({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <GenderMale className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
