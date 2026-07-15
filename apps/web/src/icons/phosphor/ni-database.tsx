import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Database } from "@phosphor-icons/react/dist/ssr";

export default function NiDatabase({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Database className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
