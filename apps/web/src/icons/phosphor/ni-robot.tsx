import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Robot } from "@phosphor-icons/react/dist/ssr";

export default function NiRobot({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Robot className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
