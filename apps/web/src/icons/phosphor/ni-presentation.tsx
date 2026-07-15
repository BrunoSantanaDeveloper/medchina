import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Presentation } from "@phosphor-icons/react/dist/ssr";

export default function NiPresentation({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Presentation className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
