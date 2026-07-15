import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Play } from "@phosphor-icons/react/dist/ssr";

export default function NiPlay({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Play className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
