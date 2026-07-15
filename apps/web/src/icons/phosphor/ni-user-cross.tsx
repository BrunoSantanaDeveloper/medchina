import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { UserMinus } from "@phosphor-icons/react/dist/ssr";

export default function NiUserCross({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <UserMinus className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
