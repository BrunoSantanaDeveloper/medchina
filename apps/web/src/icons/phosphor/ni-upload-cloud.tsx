import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CloudArrowUp } from "@phosphor-icons/react/dist/ssr";

export default function NiUploadCloud({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CloudArrowUp className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
