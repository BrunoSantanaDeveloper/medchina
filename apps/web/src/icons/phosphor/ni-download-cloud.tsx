import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CloudArrowDown } from "@phosphor-icons/react/dist/ssr";

export default function NiDownloadCloud({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CloudArrowDown
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
