import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FileCode } from "@phosphor-icons/react/dist/ssr";

export default function NiDocumentCode({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FileCode className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
