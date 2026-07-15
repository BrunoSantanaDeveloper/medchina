import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Storefront } from "@phosphor-icons/react/dist/ssr";

export default function NiStore({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Storefront className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
