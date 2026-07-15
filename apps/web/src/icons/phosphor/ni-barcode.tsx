import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Barcode } from "@phosphor-icons/react/dist/ssr";

export default function NiBarcode({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Barcode className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
