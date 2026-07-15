import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { GenderFemale } from "@phosphor-icons/react/dist/ssr";

export default function NiFemale({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <GenderFemale className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
