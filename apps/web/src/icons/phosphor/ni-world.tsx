import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Globe } from "@phosphor-icons/react/dist/ssr";

export default function NiWorld({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Globe className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
