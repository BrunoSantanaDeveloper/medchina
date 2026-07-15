import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Flask } from "@phosphor-icons/react/dist/ssr";

export default function NiFlask({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Flask className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
