import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Binoculars } from "@phosphor-icons/react/dist/ssr";

export default function NiTelescope({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Binoculars className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
