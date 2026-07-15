import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Network } from "@phosphor-icons/react/dist/ssr";

export default function NiNetwork({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Network className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
