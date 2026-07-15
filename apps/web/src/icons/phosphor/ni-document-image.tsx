import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FileImage } from "@phosphor-icons/react/dist/ssr";

export default function NiDocumentImage({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FileImage className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
