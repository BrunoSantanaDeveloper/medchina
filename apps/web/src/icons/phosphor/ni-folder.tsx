import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Folder } from "@phosphor-icons/react/dist/ssr";

export default function NiFolder({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Folder className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
