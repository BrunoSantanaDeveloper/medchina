import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Airplane } from "@phosphor-icons/react/dist/ssr";

export default function NiPlane({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Airplane className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
