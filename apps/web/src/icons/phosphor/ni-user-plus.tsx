import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { UserPlus } from "@phosphor-icons/react/dist/ssr";

export default function NiUserPlus({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <UserPlus className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
