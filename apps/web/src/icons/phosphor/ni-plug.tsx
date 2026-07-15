import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Plug } from "@phosphor-icons/react/dist/ssr";

export default function NiPlug({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Plug className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
