import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Copyright } from "@phosphor-icons/react/dist/ssr";

export default function NiCopyright({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Copyright className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
