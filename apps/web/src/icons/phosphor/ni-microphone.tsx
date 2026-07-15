import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Microphone } from "@phosphor-icons/react/dist/ssr";

export default function NiMicrophone({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Microphone className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
