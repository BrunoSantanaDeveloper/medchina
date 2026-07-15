import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Keyboard } from "@phosphor-icons/react/dist/ssr";

export default function NiKeyboard({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Keyboard className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
