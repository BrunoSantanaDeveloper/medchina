import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { EyeSlash } from "@phosphor-icons/react/dist/ssr";

export default function NiEyeInactive({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <EyeSlash className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
