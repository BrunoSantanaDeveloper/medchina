import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { UserCheck } from "@phosphor-icons/react/dist/ssr";

export default function NiUserCheck({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <UserCheck className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
