import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Archive } from "@phosphor-icons/react/dist/ssr";

export default function NiArchive({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Archive className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
