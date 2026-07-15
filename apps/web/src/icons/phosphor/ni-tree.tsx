import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Tree } from "@phosphor-icons/react/dist/ssr";

export default function NiTree({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Tree className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
