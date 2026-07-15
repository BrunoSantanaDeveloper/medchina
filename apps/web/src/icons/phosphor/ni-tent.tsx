import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Tent } from "@phosphor-icons/react/dist/ssr";

export default function NiTent({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Tent className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
