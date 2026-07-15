import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Code } from "@phosphor-icons/react/dist/ssr";

export default function NiCode({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Code className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
