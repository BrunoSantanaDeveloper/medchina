import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Buildings } from "@phosphor-icons/react/dist/ssr";

export default function NiBuilding({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Buildings className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
