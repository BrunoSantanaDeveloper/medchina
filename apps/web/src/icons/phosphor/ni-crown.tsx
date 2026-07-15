import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Crown } from "@phosphor-icons/react/dist/ssr";

export default function NiCrown({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Crown className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
