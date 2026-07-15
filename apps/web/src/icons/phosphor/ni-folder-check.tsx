import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FolderSimpleStar } from "@phosphor-icons/react/dist/ssr";

export default function NiFolderCheck({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FolderSimpleStar
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
