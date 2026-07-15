import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CircleNotch } from "@phosphor-icons/react/dist/ssr";

export default function NiProgress({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CircleNotch className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
