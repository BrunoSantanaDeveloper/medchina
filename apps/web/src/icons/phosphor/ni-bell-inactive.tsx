import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { BellSlash } from "@phosphor-icons/react/dist/ssr";

export default function NiBellInactive({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <BellSlash className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
