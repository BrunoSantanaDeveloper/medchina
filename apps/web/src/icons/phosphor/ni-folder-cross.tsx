import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FolderSimpleMinus } from "@phosphor-icons/react/dist/ssr";

export default function NiFolderCross({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FolderSimpleMinus
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
