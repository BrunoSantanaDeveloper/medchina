import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Rocket } from "@phosphor-icons/react/dist/ssr";

export default function NiRocket({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Rocket className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
