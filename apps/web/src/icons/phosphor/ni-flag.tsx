import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Flag } from "@phosphor-icons/react/dist/ssr";

export default function NiFlag({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Flag className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
