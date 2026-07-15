import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Lightbulb } from "@phosphor-icons/react/dist/ssr";

export default function NiBulbOn({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Lightbulb className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
