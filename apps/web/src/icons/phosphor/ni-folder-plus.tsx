import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FolderPlus } from "@phosphor-icons/react/dist/ssr";

export default function NiFolderPlus({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FolderPlus className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
