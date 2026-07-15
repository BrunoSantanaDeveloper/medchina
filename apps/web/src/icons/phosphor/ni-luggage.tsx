import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Suitcase } from "@phosphor-icons/react/dist/ssr";

export default function NiLuggage({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Suitcase className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
