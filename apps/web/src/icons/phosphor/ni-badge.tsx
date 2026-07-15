import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Certificate } from "@phosphor-icons/react/dist/ssr";

export default function NiBadge({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Certificate className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
