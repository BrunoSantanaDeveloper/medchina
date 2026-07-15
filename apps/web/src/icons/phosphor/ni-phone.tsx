import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { DeviceMobile } from "@phosphor-icons/react/dist/ssr";

export default function NiPhone({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <DeviceMobile className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
