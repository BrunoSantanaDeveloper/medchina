import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Signpost } from "@phosphor-icons/react/dist/ssr";

export default function NiSigns({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Signpost className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
