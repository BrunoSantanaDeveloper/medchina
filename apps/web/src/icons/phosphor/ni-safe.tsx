import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Vault } from "@phosphor-icons/react/dist/ssr";

export default function NiSafe({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Vault className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
