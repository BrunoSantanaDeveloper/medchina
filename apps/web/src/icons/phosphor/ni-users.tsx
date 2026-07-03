import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Users } from "@phosphor-icons/react/dist/ssr";

export default function NiUsers({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Users className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
