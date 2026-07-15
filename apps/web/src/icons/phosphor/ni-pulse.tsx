import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Pulse } from "@phosphor-icons/react/dist/ssr";

export default function NiPulse({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Pulse className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
