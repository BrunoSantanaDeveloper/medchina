import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Record } from "@phosphor-icons/react/dist/ssr";

export default function NiRecord({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Record className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
