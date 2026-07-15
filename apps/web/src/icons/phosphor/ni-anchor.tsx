import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Anchor } from "@phosphor-icons/react/dist/ssr";

export default function NiAnchor({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Anchor className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
