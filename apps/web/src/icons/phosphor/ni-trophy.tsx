import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Trophy } from "@phosphor-icons/react/dist/ssr";

export default function NiTrophy({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Trophy className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
