import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { User } from "@phosphor-icons/react/dist/ssr";

export default function NiUser({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <User className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
