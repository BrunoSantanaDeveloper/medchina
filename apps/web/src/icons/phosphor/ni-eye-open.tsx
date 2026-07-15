import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Eye } from "@phosphor-icons/react/dist/ssr";

export default function NiEyeOpen({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Eye className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
