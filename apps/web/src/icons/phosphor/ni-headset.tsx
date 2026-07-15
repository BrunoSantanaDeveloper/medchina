import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Headset } from "@phosphor-icons/react/dist/ssr";

export default function NiHeadset({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Headset className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
