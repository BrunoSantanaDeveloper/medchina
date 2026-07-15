import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SpinnerGap } from "@phosphor-icons/react/dist/ssr";

export default function NiLoader({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SpinnerGap className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
