import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FileText } from "@phosphor-icons/react/dist/ssr";

export default function NiDocumentFull({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FileText className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
