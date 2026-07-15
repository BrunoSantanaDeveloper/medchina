import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { EnvelopeOpen } from "@phosphor-icons/react/dist/ssr";

export default function NiEmailOpen({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <EnvelopeOpen className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
