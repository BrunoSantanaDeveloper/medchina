import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Swap } from "@phosphor-icons/react/dist/ssr";

export default function NiSwap({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Swap className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
