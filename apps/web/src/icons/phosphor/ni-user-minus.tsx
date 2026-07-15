import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { UserMinus } from "@phosphor-icons/react/dist/ssr";

export default function NiUserMinus({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <UserMinus className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
