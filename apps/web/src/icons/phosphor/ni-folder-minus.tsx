import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FolderMinus } from "@phosphor-icons/react/dist/ssr";

export default function NiFolderMinus({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FolderMinus className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
