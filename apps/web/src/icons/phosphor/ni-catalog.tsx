import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Books } from "@phosphor-icons/react/dist/ssr";

export default function NiCatalog({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Books className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
