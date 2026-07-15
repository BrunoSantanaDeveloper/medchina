import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Key } from "@phosphor-icons/react/dist/ssr";

export default function NiKey({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Key className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
