import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Cpu } from "@phosphor-icons/react/dist/ssr";

export default function NiCpu({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Cpu className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
